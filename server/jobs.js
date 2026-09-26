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

// Live progress lives in memory so we are not rewriting JSON on every ffmpeg tick.
const progress = new Map(); // key -> 0..1
const controllers = new Map(); // jobId -> AbortController
const listeners = new Set(); // (event, job) => void, e.g. run proofread when a job finishes

export const getProgress = (key) => progress.get(key) ?? null;
export const onJobEvent = (fn) => listeners.add(fn);

// ---------------------------------------------------------------- media

// Imports run one at a time so several dropped multicam files don't thrash the disk.
let importChain = Promise.resolve();

export function createMedia({ projectId, name, sourcePath, copied }) {
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
  importChain = importChain.then(() => importMedia(media.id));
  return media;
}

export const trackAudioPath = (mediaId, index) => path.join(store.mediaDir(mediaId), `track-${index}.flac`);

async function importMedia(mediaId) {
  const media = store.getMedia(mediaId);
  if (!media) return; // deleted while queued
  media.status = 'importing';
  store.saveMedia(media);
  try {
    const info = await probe(media.sourcePath);
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
          onProgress: (p) => progress.set(key, p),
        });
      } finally {
        progress.delete(key);
      }
      if (!store.getMedia(media.id)) return; // deleted mid-import
      track.extracted = true;
      store.saveMedia(media);
    }
    media.status = 'ready';
  } catch (err) {
    media.status = 'error';
    media.error = err.message;
  } finally {
    if (media.copied) fs.rmSync(media.sourcePath, { force: true });
    if (store.getMedia(media.id)) store.saveMedia(media);
  }
}

// ---------------------------------------------------------------- jobs

const wordsPath = (jobId, pos) => path.join(store.jobDir(jobId), `words-${pos}.json`);
const cuesPath = (jobId) => path.join(store.jobDir(jobId), 'cues.json');
const suggestionsPath = (jobId) => path.join(store.jobDir(jobId), 'suggestions.json');

export const readWords = (jobId, pos) => store.readJson(wordsPath(jobId, pos), null);
export const readCues = (jobId) => store.readJson(cuesPath(jobId), []);
export const writeCues = (jobId, cues) => fs.writeFileSync(cuesPath(jobId), JSON.stringify(cues));
export const readSuggestions = (jobId) => store.readJson(suggestionsPath(jobId), []);
export const writeSuggestions = (jobId, s) => fs.writeFileSync(suggestionsPath(jobId), JSON.stringify(s));

const splitTerms = (text) => String(text || '').split(/[\n,]/).map((t) => t.trim()).filter(Boolean);
const splitLines = (text) => String(text || '').split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
const selectedLists = (options, settings) => settings.termLists.filter((l) => options.termListIds?.includes(l.id));

// Key terms sent to the transcriber: free-typed extras first, then each selected list's
// priority terms. Providers cap this (Grok: 100), so the most specific terms go first.
export function resolveKeyterms(options, settings) {
  const all = [...splitTerms(options.keyterms), ...selectedLists(options, settings).flatMap((l) => splitTerms(l.terms))];
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
export function createJob({ projectId, tracks, provider, options, compareFor = null }) {
  const project = store.getProject(projectId);
  if (!project) throw new Error('Project not found.');
  if (!providers[provider]) throw new Error(`Unknown provider: ${provider}`);
  if (!tracks?.length) throw new Error('Pick at least one audio track.');
  for (const t of tracks) {
    const m = store.getMedia(t.mediaId);
    if (!m || m.status !== 'ready') throw new Error(`"${m?.displayName ?? 'A video'}" is not ready yet.`);
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

export function cancelJob(jobId) {
  controllers.get(jobId)?.abort(new Error('Cancelled'));
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
      const file = path.join(tmpDir, `chunk-${c}.${provider.codec || 'flac'}`);
      await prepareAudio(src, file, {
        cleanup: job.options.voiceCleanup,
        start: chunks > 1 ? offset : undefined,
        length: chunks > 1 ? chunkLen : undefined,
        codec: provider.codec || 'flac',
      });
      const model = job.model === 'default' ? '' : job.model;
      const result = await provider.transcribe({ file, key, model, options, signal });
      language ??= result.language;
      for (const w of result.words) words.push({ ...w, start: w.start + offset, end: w.end + offset });
      fs.rmSync(file, { force: true });
    }
    return { words, language };
  } finally {
    progress.delete(progKey);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function runJob(jobId, { onlyFailed = false } = {}) {
  const job = store.getJob(jobId);
  if (!job) return;
  const provider = providers[job.provider];
  const settings = store.getSettings();
  const key = settings.keys[job.provider];
  const keyterms = resolveKeyterms(job.options, settings);
  const controller = new AbortController();
  controllers.set(jobId, controller);

  job.status = 'running';
  job.error = null;
  if (!key) {
    job.status = 'error';
    job.error = `No API key saved for ${provider.name}. Add one in Settings.`;
    store.saveJob(job);
    controllers.delete(jobId);
    return;
  }
  store.saveJob(job);

  const todo = job.tracks.map((t, pos) => pos).filter((pos) => !onlyFailed || job.tracks[pos].status !== 'done');

  // Tracks run a few at a time, each writing its own words file.
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const pos = queue.shift();
      const track = job.tracks[pos];
      track.status = 'running';
      track.error = null;
      store.saveJob(job);
      try {
        const { words, language } = await transcribeTrack(job, pos, provider, key, keyterms, controller.signal);
        fs.writeFileSync(wordsPath(job.id, pos), JSON.stringify(words));
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
      store.saveJob(job);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));

  controllers.delete(jobId);
  const failed = job.tracks.filter((t) => t.status === 'error');
  job.status = controller.signal.aborted ? 'cancelled' : failed.length === job.tracks.length ? 'error' : 'done';
  job.error = failed.length ? `${failed.length} track(s) failed` : null;
  job.finishedAt = new Date().toISOString();
  store.saveJob(job);
  for (const fn of listeners) fn('finished', job);
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
  writeCues(jobId, cues);
  writeSuggestions(jobId, []);
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
        importChain = importChain.then(() => importMedia(media.id));
      }
    }
  }
}
