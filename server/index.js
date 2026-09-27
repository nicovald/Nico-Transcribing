import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import busboy from 'busboy';
import express from 'express';
import { pipeline } from 'node:stream/promises';
import { badRequest, object, validateId, validateOptions, validateSetup, validateSettings } from './validation.js';
import { updateTranscript } from './transcript.js';
import { safeName, uniqueFiles, exportPlan, writeExports } from './export.js';
import * as history from './history.js';
import * as jobs from './jobs.js';
import { parseTermList } from './glossary.js';
import { proofreaderList } from './proofreaders.js';
import { request } from './providers/http.js';
import { providerList } from './providers/index.js';
import { toSrt } from './srt.js';
import * as store from './store.js';
import * as sug from './suggestions.js';
import * as memory from './memory.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

store.migrate();
jobs.recoverInterrupted();

// When a job finishes: comparison jobs feed their parent; normal jobs get auto-proofread.
jobs.onJobEvent((event, job) => {
  if (event !== 'finished' || !job || !['done','partial'].includes(job.status)) return;
  if (job.compareFor) {
    sug.applyCompare(job.compareFor, job.id);
    return;
  }
  const settings = store.getSettings();
  // Learned fixes and the glossary check are free and instant, so they always run first.
  sug.runMemoryCheck(job.id).then(() => sug.runGlossaryCheck(job.id)).then(() => {
    if (!jobs.isDeleting(job.id) && store.getJob(job.id) && settings.proofread.auto && ['anthropic', 'openai', 'grok'].some((k) => settings.keys[k])) sug.startProofread(job.id);
  });
});

export const app = express();
let desktopToken = null;
export const configureDesktop = token => { desktopToken = token; };
app.use('/api', (req,res,next) => {
  if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Open this action inside Grok Transcriber.' });
  if (desktopToken && !String(req.headers.cookie || '').split(';').some(c => c.trim() === `desktop-session=${desktopToken}`)) return res.status(403).json({ error: 'This request is outside the desktop session.' });
  const devOrigin = !desktopToken && process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(req.headers.origin || '');
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && !devOrigin) return res.status(403).json({error:'This request came from another app.'});
  next();
});
app.use(express.json({ limit: '20mb' }));
app.param('id', (req,res,next,id) => { try { validateId(id); next(); } catch(err) { next(err); } });

const notFound = (res, what = 'Not found') => res.status(404).json({ error: what });

app.get('/api/version', (req, res) => res.json({ name: pkg.name, version: pkg.version }));
export const activity = () => ({ ...jobs.activeWork(), checks: sug.activeChecks() });
export async function shutdown() {
  await Promise.all([
    ...store.listMedia().map(m => jobs.stopImport(m.id)),
    ...store.listJobs().flatMap(j => [jobs.cancelJob(j.id), sug.cancelChecks(j.id)]),
  ]);
}
app.get('/api/activity', (req,res) => res.json(activity()));

// ---------------------------------------------------------------- updates (desktop only)

// The Electron shell plugs in its updater; in browser/Docker mode there is none.
let updater = null;
export const setUpdater = (u) => {
  updater = u;
};
const noUpdater = { status: 'unsupported', current: pkg.version };

app.get('/api/update', (req, res) => res.json(updater ? updater.status() : noUpdater));
app.post('/api/update/check', async (req, res) => res.json(updater ? await updater.check() : noUpdater));
app.post('/api/update/install', async (req, res) => res.json({ ok: updater ? await updater.install() : false }));

// ---------------------------------------------------------------- settings

// Keys never leave the server in full; the UI only sees whether one is set.
const maskKey = (k) => (k ? `••••${k.slice(-4)}` : '');
const publicSettings = (s) => ({ ...s, keys: Object.fromEntries(Object.entries(s.keys).map(([id, k]) => [id, maskKey(k)])) });

app.get('/api/settings', (req, res) => res.json(publicSettings(store.getSettings())));

app.put('/api/settings', (req, res) => {
  validateSettings(req.body);
  const patch = { ...req.body };
  // Only overwrite keys the user actually typed (masked values come back unchanged).
  if (patch.keys) {
    patch.keys = Object.fromEntries(
      Object.entries(patch.keys)
        .filter(([, v]) => typeof v === 'string' && !v.startsWith('••••'))
        .map(([id, v]) => [id, v.trim()]),
    );
  }
  store.saveSettings(patch);
  res.json(publicSettings(store.getSettings()));
});

// Learned fixes + people list, and sharing them as a file between teammates.
app.get('/api/memory', (req, res) => res.json(memory.memoryView()));
app.put('/api/memory/people', (req, res) => res.json(memory.savePeople(req.body.people)));
app.post('/api/memory/fixes', (req, res) => res.json(memory.addFix(object(req.body))));
app.patch('/api/memory/fixes/:id', (req, res) => res.json(memory.updateFix(req.params.id, object(req.body))));
app.delete('/api/memory/fixes/:id', (req, res) => res.json(memory.deleteFix(req.params.id)));
app.get('/api/memory/export', (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="Grok Transcriber memory ${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(memory.exportMemory());
});
app.post('/api/memory/import', (req, res) => res.json(memory.importMemory(req.body)));

app.get('/api/providers', (req, res) => res.json({ transcribers: providerList(), proofreaders: proofreaderList() }));

// Turn pasted/dropped list files into clean terms: { text } -> { terms }.
app.post('/api/terms/parse', (req, res) => res.json({ terms: parseTermList(String(req.body.text || '')) }));

// Every vanilla Minecraft name (items, blocks, mobs, biomes, enchantments, effects)
// for the latest Java version, from PrismarineJS/minecraft-data.
const MC_DATA = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data';
app.get('/api/presets/minecraft', async (req, res) => {
  try {
    const paths = await request(`${MC_DATA}/dataPaths.json`);
    const versions = Object.keys(paths.pc).filter((v) => paths.pc[v].items);
    const latest = versions.at(-1);
    const kinds = ['items', 'blocks', 'entities', 'biomes', 'enchantments', 'effects'];
    const lists = await Promise.all(
      kinds.filter((k) => paths.pc[latest][k]).map((k) => request(`${MC_DATA}/${paths.pc[latest][k]}/${k}.json`).catch(() => [])),
    );
    const terms = parseTermList(JSON.stringify(lists.flat().map((x) => x.displayName).filter((n) => n && n !== 'Air')));
    res.json({ version: latest, terms });
  } catch (err) {
    res.status(502).json({ error: `Couldn't download the Minecraft list (${err.message}). Check your internet connection.` });
  }
});

// ---------------------------------------------------------------- projects

const withMediaProgress = (m) => ({
  ...m,
  tracks: m.tracks.map((t) => ({ ...t, progress: jobs.getProgress(`media:${m.id}:${t.index}`) })),
});

function projectView(p, allMedia = store.listMedia(), allJobs = store.listJobs()) {
  const media = allMedia.filter((m) => m.projectId === p.id).reverse().map(withMediaProgress);
  const projectJobs = allJobs.filter((j) => j.projectId === p.id && !j.compareFor);
  return { ...p, presetSnapshot: p.presetSnapshot ?? findPreset(p.presetId), media, jobs: projectJobs.map(({ id, provider, model, status, createdAt, tracks }) => ({ id, provider, model, status, createdAt, trackCount: tracks.length })) };
}

app.get('/api/projects', (req, res) => { const media = store.listMedia(), jobs = store.listJobs(); res.json(store.listProjects().map(p => projectView(p,media,jobs))); });

app.get('/api/projects/:id', (req, res) => {
  const p = store.getProject(req.params.id);
  return p ? res.json(projectView(p)) : notFound(res);
});

const findPreset = (id) => (id ? store.getSettings().presets.find((x) => x.id === id) ?? null : null);

app.post('/api/projects', (req, res) => {
  const preset = findPreset(req.body.presetId);
  const project = {
    id: crypto.randomUUID(),
    name: String(req.body.name || 'Untitled project').trim(),
    presetId: preset?.id ?? null,
    presetSnapshot: preset,
    context: preset?.context ?? '',
    createdAt: new Date().toISOString(),
  };
  store.saveProject(project);
  if (preset) store.saveSettings({ lastPresetId: preset.id });
  res.json(projectView(project));
});

app.patch('/api/projects/:id', (req, res) => {
  const p = store.getProject(req.params.id);
  if (!p) return notFound(res);
  if (typeof req.body.name === 'string' && req.body.name.trim()) p.name = req.body.name.trim();
  if (typeof req.body.context === 'string') p.context = req.body.context;
  if ('setup' in req.body) p.setup = validateSetup(req.body.setup);
  if ('presetId' in req.body) {
    const preset = findPreset(req.body.presetId);
    // Switching preset brings its description along, unless you've written your own.
    const oldContext = p.presetSnapshot?.context ?? findPreset(p.presetId)?.context ?? '';
    if (preset && (!p.context || p.context === oldContext)) p.context = preset.context || '';
    p.presetId = preset?.id ?? null;
    p.presetSnapshot = preset;
    if (preset) p.setup = null;
    store.saveSettings({ lastPresetId: p.presetId });
  }
  store.saveProject(p);
  res.json(projectView(p));
});

app.delete('/api/projects/:id', async (req, res) => {
  if (!store.getProject(req.params.id)) return notFound(res);
  jobs.markDeleting(req.params.id);
  for (const j of store.listJobs()) if (j.projectId === req.params.id) await removeJob(j.id);
  for (const m of store.listMedia()) if (m.projectId === req.params.id) { await jobs.stopImport(m.id); store.deleteMedia(m.id); }
  store.deleteProject(req.params.id);
  res.json({ ok: true });
});

// Import files by their paths on this PC (desktop app + "paste path"). No copy is made.
app.post('/api/projects/:id/media', (req, res) => {
  if (!store.getProject(req.params.id)) return notFound(res);
  if (!Array.isArray(req.body.paths)) throw badRequest('Choose files to import.');
  const paths = req.body.paths.map((p) => String(p).trim().replace(/^"|"$/g, '')).filter(Boolean);
  const missing = paths.filter((p) => !fs.existsSync(p) || !fs.statSync(p).isFile());
  if (!paths.length || missing.length) return res.status(400).json({ error: `File not found: ${missing[0] || '(none)'}` });
  const created = paths.map((p) => jobs.createMedia({ projectId: req.params.id, name: path.basename(p), sourcePath: p, copied: false }));
  res.json(created);
});

// Browser fallback: stream an uploaded video straight to disk (files can be many GB).
app.post('/api/projects/:id/upload', async (req, res, next) => {
  if (!store.getProject(req.params.id)) return notFound(res);
  let dest, name, fileTask;
  try {
    const bb = busboy({ headers: req.headers, limits: { files: 1 } });
    bb.on('file', (field,file,info) => {
      name = path.basename(info.filename || 'video');
      dest = path.join(store.MEDIA_DIR,`upload-${crypto.randomUUID()}${path.extname(name)}`);
      fileTask = pipeline(file,fs.createWriteStream(dest));
      // Attach rejection handling immediately, before awaiting parser completion.
      fileTask.catch(err => bb.destroy(err));
    });
    await new Promise((resolve,reject) => {
      const aborted = () => bb.destroy(new Error('Upload interrupted'));
      req.once('aborted',aborted);
      bb.once('error',reject);
      bb.once('close',() => { req.removeListener('aborted',aborted); resolve(); });
      req.pipe(bb);
    });
    await fileTask;
    if (!dest) throw new Error('No file received');
    if (!store.getProject(req.params.id)) throw new Error('The project was removed during upload.');
    res.json(jobs.createMedia({projectId:req.params.id,name,sourcePath:dest,copied:true}));
  } catch(err) {
    await fileTask?.catch(() => {});
    if (dest) fs.rmSync(dest,{force:true});
    next(badRequest(`The upload could not finish: ${err.message}. Please try again.`));
  }
});

// ---------------------------------------------------------------- media

app.patch('/api/media/:id', (req, res) => {
  const m = store.getMedia(req.params.id);
  if (!m) return notFound(res);
  if (typeof req.body.displayName === 'string' && req.body.displayName.trim()) m.displayName = req.body.displayName.trim();
  store.saveMedia(m);
  res.json(withMediaProgress(m));
});

app.delete('/api/media/:id', async (req, res) => {
  if (!store.getMedia(req.params.id)) return notFound(res);
  if (store.listJobs().some(j => j.tracks.some(t => t.mediaId === req.params.id))) return res.status(409).json({error:'This video has transcripts. Delete those transcripts first, or delete the whole project.'});
  await jobs.stopImport(req.params.id);
  store.deleteMedia(req.params.id);
  res.json({ ok: true });
});

// Serves the extracted track for the review player (sendFile handles Range requests).
app.get('/api/media/:id/tracks/:index/audio', (req, res) => {
  const file = jobs.trackAudioPath(req.params.id, Number(req.params.index));
  if (!fs.existsSync(file)) return notFound(res);
  res.type('audio/flac').sendFile(file);
});

// ---------------------------------------------------------------- jobs

function jobView(j) {
  return {
    ...j,
    project: j.projectId ? store.getProject(j.projectId) : null,
    tracks: j.tracks.map((t, pos) => ({
      ...t,
      mediaName: store.getMedia(t.mediaId)?.displayName ?? '(deleted video)',
      progress: jobs.getProgress(`job:${j.id}:${pos}`),
    })),
  };
}

app.get('/api/jobs', (req, res) => res.json(store.listJobs().filter((j) => !j.compareFor).map(jobView)));

app.post('/api/jobs', (req, res) => {
  try {
    object(req.body);
    const job = jobs.createJob(req.body);
    // Remember these choices as the defaults for next time.
    const { provider, options } = req.body;
    store.saveSettings({ lastOptions: { ...job.options, provider } });
    jobs.runJob(job.id);
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return notFound(res);
  const compareJob = job.compare?.jobId ? store.getJob(job.compare.jobId) : null;
  res.json({
    ...jobView(job),
    compareJob: compareJob && { id: compareJob.id, provider: compareJob.provider, status: compareJob.status, error: compareJob.error },
    cues: jobs.readCues(job.id),
    suggestions: jobs.readSuggestions(job.id),
    ...history.summary(job.id),
  });
});

app.post('/api/jobs/:id/undo', (req, res) => {
  if (!store.getJob(req.params.id)) return notFound(res);
  const result = history.undo(req.params.id);
  return result ? res.json(result) : res.status(400).json({ error: 'Nothing to undo' });
});

app.post('/api/jobs/:id/retry', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return notFound(res);
  if (job.status === 'running' || jobs.isDeleting(job.id)) return res.status(409).json({ error: 'This transcript is busy.' });
  jobs.runJob(job.id, { onlyFailed: true });
  res.json({ ok: true });
});

app.post('/api/jobs/:id/cancel', async (req, res) => {
  await jobs.cancelJob(req.params.id);
  await sug.cancelChecks(req.params.id);
  res.json({ ok: true });
});

app.post('/api/jobs/:id/rebuild', async (req, res) => {
  if (!store.getJob(req.params.id)) return notFound(res);
  if (['running','queued'].includes(store.getJob(req.params.id).status)) return res.status(409).json({error:'Wait for transcription to finish before re-splitting lines.'});
  await sug.cancelChecks(req.params.id);
  const cues = jobs.rebuildCues(req.params.id);
  history.clear(req.params.id);
  res.json({ cues, suggestions: [], ...history.summary(req.params.id) });
});

app.post('/api/jobs/:id/glossary', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return notFound(res);
  // Lets you tick term lists after the fact and re-check (they also feed the next proofread).
  if (Array.isArray(req.body.termListIds)) {
    validateOptions({termListIds:req.body.termListIds});
    job.options = { ...job.options, termListIds: req.body.termListIds };
    store.saveJob(job);
  }
  sug.runGlossaryCheck(req.params.id);
  res.json({ ok: true });
});

// Re-check against what the app has learned since (older transcripts benefit too).
app.post('/api/jobs/:id/memory', (req, res) => {
  if (!store.getJob(req.params.id)) return notFound(res);
  sug.runMemoryCheck(req.params.id);
  res.json({ ok: true });
});

app.post('/api/jobs/:id/proofread', (req, res) => {
  if (!store.getJob(req.params.id)) return notFound(res);
  sug.startProofread(req.params.id);
  res.json({ ok: true });
});

// Transcribe the same tracks with another provider, then flag where they disagree.
app.post('/api/jobs/:id/compare', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return notFound(res);
  if (job.compare?.status === 'running' || ['running','queued'].includes(job.status)) return res.status(409).json({error:'Wait for the current transcription or comparison to finish.'});
  try {
    const other = jobs.createJob({
      projectId: job.projectId,
      provider: req.body.provider,
      tracks: job.tracks.map(({ mediaId, index, label }) => ({ mediaId, index, label })),
      options: job.options,
      compareFor: job.id,
    });
    job.compare = { status: 'running', jobId: other.id, provider: other.provider, error: null };
    store.saveJob(job);
    jobs.runJob(other.id).then(() => {
      const done = store.getJob(other.id);
      if (!['done','partial'].includes(done?.status)) {
        const j = store.getJob(job.id);
        if (j) {
          j.compare = { ...j.compare, status: 'error', error: done?.error || 'Comparison transcript failed' };
          store.saveJob(j);
        }
      }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/jobs/:id/cues/:cueId', (req, res) => {
  const cues = jobs.readCues(req.params.id);
  const cue = cues.find((c) => c.id === req.params.cueId);
  if (!cue) return notFound(res);
  const { text, start, end, reviewed } = req.body;
  const label = typeof text === 'string' && text !== cue.text ? `Edit line at ${Math.floor(cue.start / 60)}:${String(Math.floor(cue.start % 60)).padStart(2, '0')}` : 'Mark as checked';
  if (text != null && typeof text !== 'string') throw badRequest('Subtitle text must be text.');
  const nextStart = start ?? cue.start, nextEnd = end ?? cue.end;
  if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || nextStart < 0 || nextEnd <= nextStart) throw badRequest('The end time must be after the start time, and times cannot be negative.');
  const { state } = updateTranscript(req.params.id,state => {
    const current = state.cues.find(c=>c.id===cue.id);
    if (typeof text === 'string' && text !== current.text) {
      // Retyping a few misheard words teaches the app the same as clicking Fix.
      const lesson = memory.learnedFromEdit(current.text, text);
      if (lesson) memory.recordFix(lesson.from, lesson.to, { fixed: 1 });
      Object.assign(current,{text,edited:true});
    }
    Object.assign(current,{start:nextStart,end:nextEnd});
    if (typeof reviewed === 'boolean') current.reviewed = reviewed;
    sug.reconcileSuggestions(state);
  },label);
  res.json({ cue: state.cues.find(c=>c.id===cue.id), suggestions:state.suggestions, ...history.summary(req.params.id) });
});

app.delete('/api/jobs/:id/cues/:cueId', (req, res) => {
  const {state} = updateTranscript(req.params.id,state => {
    state.cues = state.cues.filter(c=>c.id!==req.params.cueId);
    sug.reconcileSuggestions(state);
  },'Delete line');
  res.json({ ok: true, suggestions:state.suggestions, ...history.summary(req.params.id) });
});

app.post('/api/jobs/:id/suggestions/:sid/accept', (req, res) => {
  try {
    res.json({ ...sug.acceptSuggestion(req.params.id, req.params.sid, req.body), ...history.summary(req.params.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/jobs/:id/suggestions/:sid/dismiss', (req, res) => {
  res.json({ suggestions: sug.dismissSuggestion(req.params.id, req.params.sid), ...history.summary(req.params.id) });
});

async function removeJob(id) {
  if (!store.getJob(id)) return;
  jobs.markDeleting(id);
  await jobs.cancelJob(id);
  await sug.cancelChecks(id);
  for (const child of store.listJobs()) if (child.compareFor === id) await removeJob(child.id);
  store.deleteJob(id);
}
app.delete('/api/jobs/:id', async (req, res) => {
  if (!store.getJob(req.params.id)) return notFound(res);
  await removeJob(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- export

// All SRT files a job can produce: one per track, plus one merged file per multi-track video.
function srtFiles(job, { labels = true } = {}) {
  const all = jobs.readCues(job.id);
  const files = [];
  const byMedia = new Map();
  job.tracks.forEach((t, pos) => {
    if (t.status !== 'done') return;
    if (!byMedia.has(t.mediaId)) byMedia.set(t.mediaId, []);
    byMedia.get(t.mediaId).push(pos);
  });
  for (const [mediaId, positions] of byMedia) {
    const media = store.getMedia(mediaId);
    const base = safeName(media?.displayName || 'video');
    for (const pos of positions) {
      files.push({
        key: `track-${pos}`,
        mediaId,
        filename: `${base} - ${job.tracks[pos].index + 1} ${safeName(job.tracks[pos].label)}.srt`,
        content: toSrt(all.filter((c) => c.track === pos)),
      });
    }
    if (positions.length > 1) {
      const set = new Set(positions);
      files.push({
        key: `merged-${mediaId}`,
        mediaId,
        merged: true,
        filename: `${base}.srt`,
        content: toSrt(all.filter((c) => set.has(c.track)), { label: labels ? (c) => job.tracks[c.track].label : undefined }),
      });
    }
  }
  return uniqueFiles(files);
}

// GET /api/jobs/:id/srt?file=<key>&labels=1
app.get('/api/jobs/:id/srt', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return notFound(res);
  const file = srtFiles(job, { labels: req.query.labels !== '0' }).find((f) => f.key === req.query.file);
  if (!file) return notFound(res, 'No such subtitle file');
  res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  // BOM so Premiere/Resolve on Windows read accents and emoji correctly.
  res.send(`﻿${file.content}`);
});

app.get('/api/jobs/:id/srt-files', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return notFound(res);
  res.json(
    srtFiles(job).map(({ key, mediaId, merged, filename }) => ({
      key,
      mediaId,
      merged: !!merged,
      filename,
      canSaveNextToVideo: Boolean(store.getMedia(mediaId)?.sourceDir),
    })),
  );
});

// Write SRTs next to each source video (or into `dir`).
app.post('/api/jobs/:id/export', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return notFound(res);
  const plan = exportPlan(srtFiles(job,{labels:req.body.labels !== false}),req.body,id=>store.getMedia(id)?.sourceDir);
  const written = writeExports(plan,req.body.conflict);
  res.json({ written });
});
app.post('/api/jobs/:id/export/preview', (req,res) => {
  const job = store.getJob(req.params.id);
  if (!job) return notFound(res);
  const plan = exportPlan(srtFiles(job),req.body,id=>store.getMedia(id)?.sourceDir);
  res.json({files:plan.map(({content,...f})=>f)});
});

// ---------------------------------------------------------------- web UI

const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error(err);
  if (!res.headersSent) res.status(err.status || 500).json({ error: err.message, conflicts:err.conflicts, written:err.written });
});

// Starts the server; resolves to the port actually bound (pass port 0 for any free port).
export function startServer({ port = Number(process.env.PORT) || 3462, host = process.env.HOST || '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server.address().port));
    server.on('error', reject);
  });
}

// Run directly (npm start / Docker) rather than imported by the desktop app.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = await startServer();
  const url = `http://localhost:${port}`;
  console.log(`Grok Transcriber v${pkg.version} running at ${url}`);
  if (process.env.OPEN_BROWSER === '1') {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(cmd);
  }
}
