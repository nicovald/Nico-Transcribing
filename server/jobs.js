// Media import (probe + per-track audio extraction) and transcription jobs.
//
// A job transcribes a set of tracks, possibly from several videos in one project.
// Tracks are addressed by their position in job.tracks ("track" on cues, words-<pos>.json).
import fs from 'node:fs';
import path from 'node:path';
import { extractTrack, prepareAudio, probe } from './ffmpeg.js';
import { providers } from './providers/index.js';
import { buildCues } from './srt.js';
import * as store from './store.js';
import { readTranscript, updateTranscript } from './transcript.js';
import { badRequest, validateOptions } from './validation.js';
import { withTrackSlot } from './work.js';
import { getMemory, tierOf } from './memory.js';

// Live progress lives in memory so we are not rewriting JSON on every ffmpeg tick.
const progress = new Map(); // key -> 0..1
const steps = new Map(); // job:<id>:<pos> -> { step: 'preparing' | 'sending', part, parts, since }
const controllers = new Map(); // jobId -> AbortController
const tasks = new Map();
const imports = new Map();
const deleting = new Set();
export const markDeleting = id => deleting.add(id);
export const isDeleting = id => deleting.has(id);
export const activeWork = () => ({ jobs: tasks.size, imports: imports.size });
const listeners = new Set(); // (event, job) => void, e.g. run proofread when a job finishes

export const getProgress = (key) => progress.get(key) ?? null;
// Seconds are computed here so a browser with a different clock still shows the right timer.
export function getStep(key) {
  const step = steps.get(key);
  return step ? { step: step.step, part: step.part, parts: step.parts, seconds: Math.round((Date.now() - step.since) / 1000) } : null;
}
export const onJobEvent = (fn) => listeners.add(fn);

// ---------------------------------------------------------------- media

// Imports run one at a time so several dropped multicam files don't thrash the disk.
let importChain = Promise.resolve();

export function createMedia({ projectId, name, sourcePath, copied }) {
  if (deleting.has(projectId)) throw new Error('This project is being removed.');
  const media = {
    id: crypto.randomUUID(),
    projectId,
    name,
    displayName: name.replace(/\.[^.]+$/, ''),
    sourcePath,
    sourceDir: copied ? null : path.dirname(sourcePath),
    copied, // true when sourcePath is our own uploaded copy (deleted after extraction)
    status: 'queued',
    error: null,
    duration: null,
    tracks: [],
    createdAt: new Date().toISOString(),
  };
  store.saveMedia(media);
  queueImport(media.id);
  return media;
}

export const trackAudioPath = (mediaId, index) => {
  if (!Number.isInteger(index) || index < 0) throw badRequest('Invalid audio track.');
  return path.join(store.mediaDir(mediaId), `track-${index}.flac`);
};
function queueImport(id) {
  const controller = new AbortController();
  const task = importChain.catch(() => {}).then(() => importMedia(id, controller.signal)).catch(err => console.error('Import failed:', err.message)).finally(() => imports.delete(id));
  imports.set(id, { controller, task });
  importChain = task;
}
export async function stopImport(id) {
  const work = imports.get(id);
  work?.controller.abort(new Error('Import cancelled'));
  await work?.task;
}

async function importMedia(mediaId, signal) {
  const media = store.getMedia(mediaId);
  if (!media) return; // deleted while queued
  if (signal.aborted) return;
  media.status = 'importing';
  store.saveMedia(media);
  try {
    const info = await probe(media.sourcePath, { signal });
    if (!info.tracks.length) throw new Error('No audio tracks found in this file.');
    media.duration = info.duration;
    media.tracks = info.tracks.map((t) => ({ ...t, extracted: false }));
    store.saveMedia(media);

    for (const track of media.tracks) {
      const key = `media:${media.id}:${track.index}`;
      progress.set(key, 0);
      try {
        await extractTrack(media.sourcePath, track.index, trackAudioPath(media.id, track.index), {
          duration: track.duration || info.duration,
          startOffset: track.startOffset,
          signal,
          onProgress: (p) => progress.set(key, p),
        });
      } finally {
        progress.delete(key);
      }
      if (!store.getMedia(media.id)) return; // deleted mid-import
      track.extracted = true;
      track.duration = (await probe(trackAudioPath(media.id, track.index), { signal })).duration;
      track.timelineVersion = 1;
      store.saveMedia({ ...store.getMedia(media.id), ...media, displayName: store.getMedia(media.id).displayName });
    }
    media.status = 'ready';
  } catch (err) {
    media.status = 'error';
    media.error = err.message;
  } finally {
    if (media.copied) fs.rmSync(media.sourcePath, { force: true });
    if (store.getMedia(media.id)) store.saveMedia({ ...media, displayName: store.getMedia(media.id).displayName });
  }
}

// ---------------------------------------------------------------- jobs

const wordsPath = (jobId, pos) => path.join(store.jobDir(jobId), `words-${pos}.json`);

export const readWords = (jobId, pos) => store.readJson(wordsPath(jobId, pos), null);
export const readCues = id => readTranscript(id).cues;
export const writeCues = (id, cues) => updateTranscript(id, state => { state.cues = cues; });
export const readSuggestions = id => readTranscript(id).suggestions;
export const writeSuggestions = (id, suggestions) => updateTranscript(id, state => { state.suggestions = suggestions; });

const splitTerms = (text) => String(text || '').split(/[\n,]/).map((t) => t.trim()).filter(Boolean);
const splitLines = (text) => String(text || '').split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
const selectedLists = (options, settings) => settings.termLists.filter((l) => options.termListIds?.includes(l.id));

// Key terms sent to the transcriber: free-typed extras first, then the people list, each selected
// list's priority terms, then confidently learned fixes. Providers cap this (Grok: 100), so the
// most specific terms go first.
export function resolveKeyterms(options, settings) {
  const memory = getMemory();
  const all = [
    ...splitTerms(options.keyterms),
    ...memory.people.map((p) => p.name),
    ...selectedLists(options, settings).flatMap((l) => splitTerms(l.terms)),
    ...memory.fixes.filter((f) => tierOf(f) === 'usual').map((f) => f.to),
  ];
  return [...new Set(all)].join(', ');
}

// Every term from the selected lists (priority + full glossary), for checking after transcription.
export function resolveGlossary(options, settings) {
  const all = [
    ...splitTerms(options.keyterms),
    // Glossary is one term per line, since names like "Bucket of Salmon, Raw" may contain commas.
    ...selectedLists(options, settings).flatMap((l) => [...splitTerms(l.terms), ...splitLines(l.glossary)]),
  ];
  return [...new Set(all)];
}

// tracks: [{ mediaId, index, label }]
export function createJob({ projectId, tracks, provider, options = {}, compareFor = null }) {
  const project = store.getProject(projectId);
  if (!project) throw new Error('Project not found.');
  if (deleting.has(projectId)) throw new Error('This project is being removed.');
  if (!Object.hasOwn(providers, provider)) throw new Error(`Unknown provider: ${provider}`);
  if (!Array.isArray(tracks) || !tracks.length) throw badRequest('Pick at least one audio track.');
  options = { ...store.DEFAULT_SETTINGS.lastOptions, ...validateOptions(options) };
  const selected = new Set();
  for (const t of tracks) {
    const m = store.getMedia(t.mediaId);
    if (!m || m.status !== 'ready') throw new Error(`"${m?.displayName ?? 'A video'}" is not ready yet.`);
    if (m.projectId !== projectId || !Number.isInteger(t.index) || !m.tracks.some(track => track.index === t.index && track.extracted)) throw badRequest('Choose an available track from this project.');
    if (t.label != null && typeof t.label !== 'string') throw badRequest('Track names must be text.');
    const tk = `${t.mediaId}:${t.index}`;
    if (selected.has(tk)) throw badRequest('The same track was selected twice.');
    selected.add(tk);
  }

  const job = {
    id: crypto.randomUUID(),
    projectId,
    provider,
    model: store.getSettings().models[provider] || providers[provider].model || 'default',
    options,
    compareFor, // set when this job only exists to cross-check another job
    status: 'queued',
    error: null,
    proofread: null,
    compare: null,
    tracks: tracks.map((t) => ({
      mediaId: t.mediaId,
      index: t.index,
      label: t.label?.trim() || `Track ${t.index + 1}`,
      status: 'queued',
      error: null,
      language: null,
      wordCount: 0,
      hasConfidence: false,
    })),
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  store.saveJob(job);
  writeCues(job.id, []);
  return job;
}

export async function cancelJob(jobId) {
  controllers.get(jobId)?.abort(new Error('Cancelled'));
  await tasks.get(jobId);
}

// Transcribe one track, chunking the audio if the provider has a size limit.
async function transcribeTrack(job, pos, provider, key, keyterms, signal) {
  const track = job.tracks[pos];
  const src = trackAudioPath(track.mediaId, track.index);
  const media = store.getMedia(track.mediaId);
  const duration = media.tracks[track.index]?.duration || media.duration || 0;
  const tmpDir = path.join(store.jobDir(job.id), `tmp-${pos}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const progKey = `job:${job.id}:${pos}`;
  const options = { ...job.options, keyterms };

  try {
    const chunkLen = provider.chunkSeconds;
    const chunks = chunkLen && duration > chunkLen ? Math.ceil(duration / chunkLen) : 1;
    const words = [];
    let language = null;

    for (let c = 0; c < chunks; c++) {
      signal.throwIfAborted();
      progress.set(progKey, c / chunks);
      const offset = chunks > 1 ? c * chunkLen : 0;
      const cache = path.join(store.jobDir(job.id), `chunk-${pos}-${c}.json`);
      const signature = JSON.stringify({ model: job.model, options, offset, chunkLen });
      const cached = store.readJson(cache, null);
      let result = cached?.signature === signature ? cached.result : null;
      const file = path.join(tmpDir, `chunk-${c}.${provider.codec || 'flac'}`);
      if (!result) {
      const part = { part: c + 1, parts: chunks };
      steps.set(progKey, { step: 'preparing', ...part, since: Date.now() });
      await prepareAudio(src, file, {
        cleanup: job.options.voiceCleanup,
        start: chunks > 1 ? offset : undefined,
        length: chunks > 1 ? chunkLen : undefined,
        codec: provider.codec || 'flac',
        signal,
      });
      const model = job.model === 'default' ? '' : job.model;
      signal.throwIfAborted();
      steps.set(progKey, { step: 'sending', ...part, since: Date.now() });
      result = await provider.transcribe({ file, key, model, options, signal });
      signal.throwIfAborted();
      if (!Array.isArray(result?.words) || result.words.some(w => typeof w.text !== 'string' || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end < w.start)) throw new Error('The service returned invalid word timings. Please retry or choose another service.');
      store.writeJson(cache, { signature, result });
      }
      language ??= result.language;
      for (const w of result.words) words.push({ ...w, start: w.start + offset, end: w.end + offset });
      fs.rmSync(file, { force: true });
    }
    return { words, language };
  } finally {
    progress.delete(progKey);
    steps.delete(progKey);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function runJob(jobId, options = {}) {
  if (tasks.has(jobId)) return tasks.get(jobId);
  if (deleting.has(jobId)) return Promise.resolve();
  const controller = new AbortController();
  controllers.set(jobId, controller);
  const task = Promise.resolve().then(() => executeJob(jobId, options, controller)).catch(err => {
    const job = store.getJob(jobId);
    if (job && !deleting.has(jobId)) store.saveJob({ ...job, status: 'error', error: err.message });
  }).finally(() => { tasks.delete(jobId); controllers.delete(jobId); });
  tasks.set(jobId, task);
  return task;
}
async function executeJob(jobId, { onlyFailed = false }, controller) {
  const job = store.getJob(jobId);
  if (!job) return;
  const provider = providers[job.provider];
  const settings = store.getSettings();
  const key = settings.keys[job.provider];
  const keyterms = resolveKeyterms(job.options, settings);
  const persist = () => {
    const current = store.getJob(jobId);
    if (current && !deleting.has(jobId)) store.saveJob({ ...current, status: job.status, error: job.error, tracks: job.tracks, finishedAt: job.finishedAt });
  };

  job.status = 'running';
  job.error = null;
  if (!key) {
    job.status = 'error';
    job.error = `No API key saved for ${provider.name}. Add one in Settings.`;
    for (const track of job.tracks) if (track.status !== 'done') Object.assign(track, { status: 'error', error: job.error });
    persist();
    return;
  }
  persist();

  const todo = job.tracks.map((t, pos) => pos).filter((pos) => !onlyFailed || job.tracks[pos].status !== 'done');

  // Tracks run a few at a time, each writing its own words file.
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const pos = queue.shift();
      const track = job.tracks[pos];
      track.status = 'running';
      track.error = null;
      persist();
      try {
        const { words, language } = await withTrackSlot(controller.signal, () => transcribeTrack(job, pos, provider, key, keyterms, controller.signal));
        controller.signal.throwIfAborted();
        if (deleting.has(jobId)) return;
        store.writeJson(wordsPath(job.id, pos), words);
        track.status = 'done';
        track.language = language;
        track.wordCount = words.length;
        track.hasConfidence = words.some((w) => w.confidence != null);
        const others = readCues(job.id).filter((c) => c.track !== pos);
        writeCues(job.id, [...others, ...buildCues(words, settings.cue, pos)]);
      } catch (err) {
        track.status = 'error';
        track.error = controller.signal.aborted ? 'Cancelled' : err.message;
      }
      persist();
    }
  };
  const workers = await Promise.allSettled(Array.from({ length: Math.min(4, todo.length) }, worker));
  const failedWorker = workers.find(result => result.status === 'rejected');
  if (failedWorker) throw failedWorker.reason;

  const failed = job.tracks.filter((t) => t.status === 'error');
  job.status = controller.signal.aborted ? 'cancelled' : failed.length === job.tracks.length ? 'error' : failed.length ? 'partial' : 'done';
  job.error = failed.length ? `${failed.length} track(s) failed` : null;
  job.finishedAt = new Date().toISOString();
  persist();
  if (!deleting.has(jobId)) for (const fn of listeners) await fn('finished', store.getJob(jobId));
}

// Rebuild cues from stored words using the current cue settings (drops text edits).
export function rebuildCues(jobId) {
  const job = store.getJob(jobId);
  const settings = store.getSettings();
  const cues = [];
  job.tracks.forEach((t, pos) => {
    const words = readWords(jobId, pos);
    if (words) cues.push(...buildCues(words, settings.cue, pos));
  });
  updateTranscript(jobId, state => { state.cues = cues; state.suggestions = []; state.history = []; });
  return cues;
}

// Anything left running when the app last closed can never finish; mark it.
export function recoverInterrupted() {
  for (const job of store.listJobs()) {
    let changed = false;
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'error';
      job.error = 'Interrupted (app was closed). Hit Retry.';
      for (const t of job.tracks) if (t.status !== 'done') Object.assign(t, { status: 'error', error: 'Interrupted' });
      changed = true;
    }
    for (const k of ['proofread', 'compare', 'glossary']) {
      if (job[k]?.status === 'running') {
        job[k] = { ...job[k], status: 'error', error: 'Interrupted (app was closed).' };
        changed = true;
      }
    }
    if (changed) store.saveJob(job);
  }
  for (const media of store.listMedia()) {
    if (media.status === 'importing' || media.status === 'queued') {
      if (media.copied) {
        media.status = 'error';
        media.error = 'Import interrupted (app was closed). Import the file again.';
        store.saveMedia(media);
      } else {
        // We still have the original file, so just redo the import.
        queueImport(media.id);
      }
    }
  }
}
