// JSON-file storage for settings, projects, imported media and transcription jobs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isId, validateId, validateSettings } from './validation.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
let secrets = null;
const SECRET_PREFIX = 'protected:v1:';

// Electron supplies Windows-backed encryption after app.whenReady().
export function configureSecrets(codec) {
  secrets = codec;
  const saved = readJson(SETTINGS_FILE, {});
  if (Object.values(saved.keys || {}).some(k => k && !k.startsWith(SECRET_PREFIX))) {
    saveSettings({});
    // Do not retain a plaintext backup after migrating keys.
    fs.copyFileSync(SETTINGS_FILE, `${SETTINGS_FILE}.bak`);
  }
}

for (const dir of [DATA_DIR, PROJECTS_DIR, MEDIA_DIR, JOBS_DIR]) fs.mkdirSync(dir, { recursive: true });

export const DEFAULT_SETTINGS = {
  keys: { grok: '', openai: '', deepgram: '', assemblyai: '', elevenlabs: '', anthropic: '', typesafe: '', github: '' },
  // Optional per-provider model override; empty uses the provider default.
  models: {},
  // Options from the last transcript started, reused as the next defaults.
  lastOptions: {
    provider: 'grok',
    language: 'en',
    termListIds: [],
    keyterms: '',
    voiceCleanup: true,
    fillerWords: false,
    diarize: false,
  },
  // Reusable key-term lists, e.g. one per game.
  termLists: [],
  // Presets bundle everything that repeats for a series (e.g. "ATM10 To The Sky"):
  // { id, name, context, termListIds, keyterms, language, provider, voiceCleanup,
  //   diarize, fillerWords, tracks: [{ name, on }] } where tracks[i] is audio track i.
  presets: [],
  lastPresetId: null,
  // AI proofread: provider 'claude' | 'openai' | 'grok' (falls back to whichever has a key).
  proofread: { auto: true, provider: 'claude', models: {} },
  confidenceThreshold: 0.6,
  cue: { maxLineChars: 42, maxLines: 2, maxDuration: 6, pauseSplit: 0.8, minDuration: 0.8 },
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    if (!(err instanceof SyntaxError)) throw err;
    try {
      const backup = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
      fs.copyFileSync(file, `${file}.damaged-${Date.now()}`);
      fs.copyFileSync(`${file}.bak`, file);
      console.warn(`Recovered ${path.basename(file)} from its backup.`);
      return backup;
    } catch {
      throw new Error(`The saved ${path.basename(file)} could not be read. Keep your data folder and contact your administrator; no data was overwritten.`);
    }
  }
}

// Write to a temp file then rename so a crash mid-write never corrupts state.
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    if (fs.existsSync(file)) {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.copyFileSync(file, `${file}.bak`);
    }
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}
export { readJson };

const OBJECT_KEYS = ['keys', 'models', 'lastOptions', 'proofread', 'cue'];

export function getSettings() {
  const saved = readJson(SETTINGS_FILE, {});
  if (saved.keys) saved.keys = Object.fromEntries(Object.entries(saved.keys).map(([id,key]) => {
    if (!key.startsWith(SECRET_PREFIX)) return [id,key];
    if (!secrets) throw new Error('These API keys are protected by the desktop app. Open Grok Transcriber with the Windows account that saved them.');
    try { return [id,secrets.decrypt(key.slice(SECRET_PREFIX.length))]; }
    catch { throw new Error('Windows could not unlock the saved API keys. Use the Windows account that saved them, or ask your administrator to reset settings.json.'); }
  }));
  const merged = { ...DEFAULT_SETTINGS, ...saved };
  for (const k of OBJECT_KEYS) merged[k] = { ...DEFAULT_SETTINGS[k], ...saved[k] };
  // Settings from v0.1 kept these at the top level.
  if (saved.defaultProvider && !saved.lastOptions) merged.lastOptions.provider = saved.defaultProvider;
  return merged;
}

export function saveSettings(patch) {
  validateSettings(patch);
  const current = getSettings();
  const next = { ...current, ...patch };
  for (const k of OBJECT_KEYS) next[k] = { ...current[k], ...patch[k] };
  for (const k of ['defaultProvider', 'language', 'keyterms', 'voiceCleanup', 'fillerWords', 'diarize']) delete next[k];
  const disk = secrets ? { ...next, keys: Object.fromEntries(Object.entries(next.keys).map(([id,key]) => [id,key ? SECRET_PREFIX + secrets.encrypt(key) : ''])) } : next;
  writeJson(SETTINGS_FILE, disk);
  return next;
}

// ---- generic per-id JSON collections ----
function collection(dir, file) {
  const dirOf = (id) => path.join(dir, validateId(id));
  const get = (id) => readJson(path.join(dirOf(id), file), null);
  return {
    dir: dirOf,
    get,
    save: (item) => writeJson(path.join(dirOf(item.id), file), item),
    list: () =>
      fs
        .readdirSync(dir)
        .filter(isId)
        .map(get)
        .filter(Boolean)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    remove: (id) => fs.rmSync(dirOf(id), { recursive: true, force: true }),
  };
}

const projects = collection(PROJECTS_DIR, 'project.json');
const media = collection(MEDIA_DIR, 'media.json');
const jobs = collection(JOBS_DIR, 'job.json');

export const { get: getProject, save: saveProject, list: listProjects, remove: deleteProject } = projects;
export const { dir: mediaDir, get: getMedia, save: saveMedia, list: listMedia, remove: deleteMedia } = media;
export const { dir: jobDir, get: getJob, save: saveJob, list: listJobs, remove: deleteJob } = jobs;

// ---- v0.1 -> v0.2 migration: media without a project, jobs keyed by audio index ----
export function migrate() {
  for (const m of listMedia()) {
    if (m.projectId) continue;
    const project = { id: crypto.randomUUID(), name: m.name.replace(/\.[^.]+$/, ''), context: '', createdAt: m.createdAt };
    saveProject(project);
    m.projectId = project.id;
    m.displayName ??= m.name.replace(/\.[^.]+$/, '');
    m.sourceDir ??= m.copied ? null : path.dirname(m.sourcePath);
    saveMedia(m);
  }

  for (const job of listJobs()) {
    if (job.projectId) continue;
    const m = getMedia(job.mediaId);
    job.projectId = m?.projectId ?? null;
    const dir = jobDir(job.id);
    // Old jobs keyed words files and cues by audio index; new ones by position in job.tracks.
    const posOf = new Map(job.tracks.map((t, pos) => [t.index, pos]));
    job.tracks = job.tracks.map((t, pos) => {
      const oldWords = path.join(dir, `words-${t.index}.json`);
      const tmpWords = path.join(dir, `words-migrate-${pos}.json`);
      if (fs.existsSync(oldWords)) fs.renameSync(oldWords, tmpWords);
      return { ...t, mediaId: job.mediaId };
    });
    job.tracks.forEach((t, pos) => {
      const tmpWords = path.join(dir, `words-migrate-${pos}.json`);
      if (fs.existsSync(tmpWords)) fs.renameSync(tmpWords, path.join(dir, `words-${pos}.json`));
    });
    const cues = readJson(path.join(dir, 'cues.json'), []);
    for (const c of cues) {
      const pos = posOf.get(c.track) ?? 0;
      c.track = pos;
      c.id = `${pos}-${c.id.split('-').pop()}`;
    }
    writeJson(path.join(dir, 'cues.json'), cues);
    delete job.mediaId;
    delete job.mediaName;
    saveJob(job);
  }
}
