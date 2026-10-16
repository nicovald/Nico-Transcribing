// Media import (probe + per-track audio extraction) and transcription jobs.
//
// A job transcribes a set of tracks, possibly from several videos in one project.
// Tracks are addressed by their position in job.tracks ("track" on cues, words-<pos>.json).
import fs from 'node:fs';
import path from 'node:path';
import { extractTrack, prepareAudio, probe } from './ffmpeg.js';
import { keytermLimits, limitKeyterms, splitKeyterms } from './providers/http.js';
import { providers } from './providers/index.js';
import { buildCues } from './srt.js';
import * as store from './store.js';
import { readTranscript, updateTranscript } from './transcript.js';
import { badRequest, validateOptions } from './validation.js';
import { withTrackSlot } from './work.js';
import { getMemory, tierOf } from './memory.js';
import { deleteBlob, downloadBlob } from './cloud.js';

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

export function createMedia({ projectId, name, sourcePath, copied, downloadUrl = null }) {
  if (deleting.has(projectId)) throw new Error('This project is being removed.');
  const media = {
    id: crypto.randomUUID(),
    projectId,
    name,
    displayName: name.replace(/\.[^.]+$/, ''),
    sourcePath,
    sourceDir: copied ? null : path.dirname(sourcePath),
    copied, // true when sourcePath is our own uploaded copy (deleted after extraction)
    downloadUrl, // team mode: the upload waits in Blob storage until the import copies it to sourcePath
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
    if (media.downloadUrl) {
      const key = `media:${media.id}:download`;
      progress.set(key, 0);
      try { await downloadBlob(media.downloadUrl, media.sourcePath, { signal, onProgress: p => progress.set(key, p) }); }
      finally { progress.delete(key); }
      await deleteBlob(media.downloadUrl);
      media.downloadUrl = null;
      store.saveMedia({ ...media, displayName: store.getMedia(media.id)?.displayName ?? media.displayName });
    }
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

// Comma/newline separated; "quoted, terms" keep their comma.
const splitTerms = (text) => splitKeyterms(text);
const splitLines = (text) => String(text || '').split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
const selectedLists = (options, settings) => settings.termLists.filter((l) => options.termListIds?.includes(l.id));

// Key terms sent to the transcriber, most important first, because every provider caps them
// (see each provider's `keyterms` limits): people names, confidently learned fixes, the extras
// typed for this video, then the selected lists' priority terms taken in turn so one big list
// can't crowd out the others. Deduped case-insensitively (first spelling wins).
export function resolveKeytermList(options, settings) {
  const memory = getMemory();
  const lists = selectedLists(options, settings).map((l) => splitTerms(l.terms));
  const fair = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) fair.push(l[i]);
  const all = [
    ...memory.people.map((p) => String(p.name || '').trim()),
    ...memory.fixes.filter((f) => tierOf(f) === 'usual').map((f) => String(f.to || '').trim()),
    ...splitTerms(options.keyterms),
    ...fair,
  ];
  const seen = new Set();
  return all.filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

// The same list as one comma separated string (the proofreader prompt uses this).
export const resolveKeyterms = (options, settings) => resolveKeytermList(options, settings).join(', ');

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
    compares: {}, // second opinions keyed by provider id
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

// Split a track into chunks of chunkLen seconds. Each chunk owns [c*len, (c+1)*len) but is cut
// `overlap` seconds wider on both sides, so a word at a cut is heard whole by the chunk that owns it.
export function chunkPlan(duration, chunkLen, overlap = 0) {
  if (!chunkLen || !(duration > chunkLen)) return [{ start: 0, length: undefined, ownStart: -Infinity, ownEnd: Infinity }];
  const count = Math.ceil(duration / chunkLen);
  return Array.from({ length: count }, (_, c) => {
    const ownStart = c * chunkLen;
    const ownEnd = (c + 1) * chunkLen;
    const start = Math.max(0, ownStart - overlap);
    return { start, length: ownEnd + overlap - start, ownStart: c ? ownStart : -Infinity, ownEnd: c < count - 1 ? ownEnd : Infinity };
  });
}

const bareWord = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const timeOverlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
// Same word heard twice: same text and over half of the shorter one overlaps the other in time.
const sameWord = (a, b) =>
  bareWord(a.text) === bareWord(b.text) &&
  timeOverlap(a, b) > 0.5 * Math.max(0.01, Math.min(a.end - a.start, b.end - b.start));

// Pick one splice time for the overlap between two chunks: the middle of the longest silence
// (no word from either chunk) in the inner half of the overlap, else the nominal cut.
function spliceTime(prev, next, cut, overlap) {
  const lo = cut - overlap / 2;
  const hi = cut + overlap / 2;
  const spans = [...prev, ...next].filter((w) => w.end > cut - overlap && w.start < cut + overlap).sort((a, b) => a.start - b.start);
  let best = null;
  let reach = cut - overlap;
  for (const w of spans) {
    if (w.start > reach) {
      const a = Math.max(reach, lo);
      const b = Math.min(w.start, hi);
      if (b - a > 0.05 && (!best || b - a > best.len + 1e-9 || (Math.abs(b - a - best.len) < 1e-9 && Math.abs((a + b) / 2 - cut) < Math.abs(best.at - cut)))) best = { len: b - a, at: (a + b) / 2 };
    }
    reach = Math.max(reach, w.end);
  }
  return best ? best.at : cut;
}

// Align the two chunks' words inside the overlap by text (longest common subsequence, times within
// ~1.5 s). Returns [prevIndex, nextIndex] of the matched pair nearest the cut, with all pairs as .pairs.
function findAnchor(prevTail, next, nextWin, cut) {
  const mid = (w) => (w.start + w.end) / 2;
  const A = prevTail.map((w) => bareWord(w.text));
  const B = nextWin.map((w) => bareWord(w.text));
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  const ok = (i, j) => A[i] && A[i] === B[j] && Math.abs(mid(prevTail[i]) - mid(next[j])) <= 1.5;
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = ok(i, j) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < A.length && j < B.length;) {
    if (ok(i, j) && dp[i][j] === dp[i + 1][j + 1] + 1) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  if (!pairs.length) return null;
  const best = pairs.reduce((m, p) => (Math.abs(mid(prevTail[p[0]]) - cut) < Math.abs(mid(prevTail[m[0]]) - cut) ? p : m));
  const anchor = [...best];
  anchor.pairs = pairs;
  return anchor;
}

// Join chunk transcripts (word times relative to each chunk) into one track timeline.
// Neighboring chunks heard the overlap twice; they share ONE splice point: the earlier chunk
// supplies words before it, the later chunk words after it. Words crossing the splice are kept
// once (same text, overlapping in time), and a word only one chunk heard is never dropped.
export function stitchChunks(chunkWords, plan) {
  let kept = [];
  chunkWords.forEach((words, c) => {
    const chunk = plan[c];
    const next = words.map((w) => ({ ...w, start: w.start + chunk.start, end: w.end + chunk.start }));
    if (!c) { kept = next; return; }
    const cut = chunk.ownStart;
    const overlap = cut - chunk.start;
    const windowStart = chunk.start;
    const prevTail = kept.filter((w) => w.end > windowStart);
    const prevHead = kept.filter((w) => w.end <= windowStart);
    const nextWin = next.filter((w) => w.start < cut + overlap);
    const anchor = findAnchor(prevTail, next, nextWin, cut);
    if (anchor) {
      // Words both chunks heard (aligned by text) are kept once: earlier chunk up to the anchor, later chunk after it.
      // A word only one chunk heard stays unless it sits on top of a word the authoritative side already has.
      const [ai, bj] = anchor;
      const headPrev = prevTail.slice(0, ai + 1);
      const tailNext = next.slice(bj + 1);
      const matchedPrev = new Set(anchor.pairs.map(([i]) => prevTail[i]));
      const matchedNext = new Set(anchor.pairs.map(([, j]) => next[j]));
      const out = [...headPrev, ...tailNext];
      for (const w of prevTail.slice(ai + 1)) if (!matchedPrev.has(w) && !tailNext.some((o) => timeOverlap(w, o) > 0)) out.push(w);
      for (const w of next.slice(0, bj + 1)) if (!matchedNext.has(w) && !headPrev.some((o) => timeOverlap(w, o) > 0)) out.push(w);
      out.sort((a, b) => a.start - b.start);
      kept = [...prevHead, ...out];
      return;
    }
    const splice = spliceTime(prevTail, nextWin, cut, overlap);
    const crosses = (w) => w.start < splice && w.end > splice;
    const heardBy = (w, others) => others.some((o) => timeOverlap(w, o) > 0);

    const out = [];
    // Earlier chunk: words before the splice, plus later words the next chunk didn't hear at all.
    for (const w of prevTail) {
      if (w.end <= splice || (!crosses(w) && !heardBy(w, next))) out.push(w);
    }
    // Later chunk: words after the splice, plus earlier words the previous chunk didn't hear.
    for (const w of next) {
      if (w.start >= splice || (!crosses(w) && !heardBy(w, prevTail))) out.push(w);
    }
    // Words crossing the splice: keep each one once, preferring the copy whose middle is on its own side.
    const prevCross = prevTail.filter(crosses);
    const nextCross = next.filter(crosses);
    const used = new Set();
    for (const p of prevCross) {
      const twin = nextCross.find((n) => !used.has(n) && bareWord(n.text) === bareWord(p.text));
      if (!twin) { if (!out.some((k) => sameWord(k, p))) out.push(p); continue; }
      used.add(twin);
      const nextOwns = (twin.start + twin.end) / 2 >= splice && (p.start + p.end) / 2 >= splice;
      out.push(nextOwns ? twin : p);
    }
    for (const n of nextCross) {
      if (!used.has(n) && !out.some((k) => sameWord(k, n))) out.push(n);
    }
    out.sort((a, b) => a.start - b.start);
    kept = [...prevHead, ...out];
  });
  return kept;
}

// Services sometimes send a few words with missing or broken times (ElevenLabs can send null).
// Fix those from their neighbors instead of failing the track; only give up when most are bad.
export function repairWords(words, service = 'The service') {
  if (!Array.isArray(words)) throw new Error(`${service} sent back a transcript we couldn't read. Please retry or choose another service.`);
  const time = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const nextStart = (i) => {
    for (let j = i + 1; j < words.length; j++) {
      if (typeof words[j]?.text !== 'string') continue;
      const t = time(words[j].start) ?? time(words[j].end);
      if (t != null) return t;
    }
    return null;
  };
  const out = [];
  let bad = 0;
  words.forEach((w, i) => {
    if (typeof w?.text !== 'string') return bad++;
    if (!w.text.trim()) return; // empty filler, nothing to show
    let start = time(w.start);
    let end = time(w.end);
    if (start == null && end == null) {
      const prev = out.at(-1)?.end ?? null;
      const next = nextStart(i);
      if (prev == null && next == null) return bad++;
      start = prev ?? next;
      end = Math.min(next ?? start, start + 1);
    }
    start ??= end;
    end ??= start;
    if (end < start) end = start;
    out.push({ ...w, start, end });
  });
  if (words.length && bad > words.length / 2) throw new Error(`${service} returned words without usable timings. Please retry or choose another service.`);
  return out;
}

// Length of a job track's audio in seconds (0 when unknown, e.g. the video was removed).
const trackDuration = (track) => {
  const media = store.getMedia(track.mediaId);
  return media?.tracks.find((t) => t.index === track.index)?.duration || media?.duration || 0;
};

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
    const overlap = Math.min(provider.chunkOverlap || 0, (chunkLen || 0) / 4);
    const plan = chunkPlan(duration, chunkLen, overlap);
    const chunks = plan.length;
    const chunkWords = [];
    let language = null;

    for (let c = 0; c < chunks; c++) {
      signal.throwIfAborted();
      progress.set(progKey, c / chunks);
      const chunk = plan[c];
      const cache = path.join(store.jobDir(job.id), `chunk-${pos}-${c}.json`);
      const signature = JSON.stringify({ model: job.model, options, offset: chunk.start, length: chunk.length, chunkLen, overlap });
      const cached = store.readJson(cache, null);
      let result = cached?.signature === signature ? cached.result : null;
      const file = path.join(tmpDir, `chunk-${c}.${provider.codec || 'flac'}`);
      if (!result) {
      const part = { part: c + 1, parts: chunks };
      steps.set(progKey, { step: 'preparing', ...part, since: Date.now() });
      await prepareAudio(src, file, {
        cleanup: job.options.voiceCleanup,
        start: chunks > 1 ? chunk.start : undefined,
        length: chunks > 1 ? chunk.length : undefined,
        codec: provider.codec || 'flac',
        signal,
      });
      const model = job.model === 'default' ? '' : job.model;
      signal.throwIfAborted();
      steps.set(progKey, { step: 'sending', ...part, since: Date.now() });
      result = await provider.transcribe({ file, key, model, options, signal });
      signal.throwIfAborted();
      result = { ...result, words: repairWords(result?.words, provider.name) };
      store.writeJson(cache, { signature, result });
      }
      language ??= result.language;
      chunkWords.push(result.words);
      fs.rmSync(file, { force: true });
    }
    return { words: stitchChunks(chunkWords, plan), language };
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
  // Fit the key terms to this provider's limits once, and remember how many made it.
  const { terms: keyterms, total: keytermsTotal } = limitKeyterms(resolveKeytermList(job.options, settings), keytermLimits(provider, job.model === 'default' ? '' : job.model, job.options));
  job.keytermsSent = keyterms.length;
  job.keytermsTotal = keytermsTotal;
  const persist = () => {
    const current = store.getJob(jobId);
    if (current && !deleting.has(jobId)) store.saveJob({ ...current, status: job.status, error: job.error, tracks: job.tracks, finishedAt: job.finishedAt, keytermsSent: job.keytermsSent, keytermsTotal: job.keytermsTotal });
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
        writeCues(job.id, [...others, ...buildCues(words, { ...settings.cue, mediaDuration: trackDuration(track) }, pos)]);
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
    if (words) cues.push(...buildCues(words, { ...settings.cue, mediaDuration: trackDuration(t) }, pos));
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
    for (const entry of [job.proofread, job.glossary, ...Object.values(job.compares || {})]) {
      if (entry?.status === 'running') {
        Object.assign(entry, { status: 'error', error: 'Interrupted (app was closed).' });
        changed = true;
      }
    }
    if (changed) store.saveJob(job);
  }
  for (const media of store.listMedia()) {
    if (media.status === 'importing' || media.status === 'queued') {
      if (media.copied && !media.downloadUrl) {
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
