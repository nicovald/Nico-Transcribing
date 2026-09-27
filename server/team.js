// Team setup (Ctrl+Shift+T): a studio hands editors a .env file with the API keys it pays for,
// and optionally a settings file with its suggested setup. Keys are stored like typed keys
// and never sent back.
import { exportMemory, importMemory } from './memory.js';
import * as store from './store.js';
import { badRequest, validateSettings } from './validation.js';

// Common env names for each service's key.
const ENV_NAMES = {
  grok: ['XAI_API_KEY', 'GROK_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  deepgram: ['DEEPGRAM_API_KEY'],
  assemblyai: ['ASSEMBLYAI_API_KEY'],
  elevenlabs: ['ELEVENLABS_API_KEY', 'XI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  typesafe: ['TYPESAFE_API_KEY'],
  github: ['GITHUB_TOKEN', 'GH_TOKEN'],
};
const SERVICE_NAMES = {
  grok: 'Grok (xAI)', openai: 'OpenAI', deepgram: 'Deepgram', assemblyai: 'AssemblyAI',
  elevenlabs: 'ElevenLabs', anthropic: 'Claude (Anthropic)', typesafe: 'TypeSafe (Jev)', github: 'App updates (GitHub)',
};
const byEnvName = new Map(Object.entries(ENV_NAMES).flatMap(([id, names]) => names.map((n) => [n, id])));

// KEY=value lines; blank lines, # comments, `export` prefixes and quotes are fine.
// Returns { keys: { grok: '…' }, services: ['Grok (xAI)'], ignored: ['SOME_OTHER_VAR'] }.
export function parseTeamEnv(text) {
  const keys = {};
  const ignored = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const name = m[1].toUpperCase();
    let value = m[2].trim();
    const quoted = value.match(/^(["'])(.*)\1$/);
    value = quoted ? quoted[2] : value.replace(/\s+#.*$/, '');
    const id = byEnvName.get(name);
    if (!id) ignored.push(m[1]);
    else if (value) keys[id] = value;
  }
  return { keys, services: Object.keys(keys).map((id) => SERVICE_NAMES[id]), ignored };
}

// ---------------------------------------------------------------- settings files

const KIND = 'grok-transcriber-settings';

// Everything that makes up "how we work", never API keys.
export function exportTeamSettings() {
  const s = store.getSettings();
  const { people, fixes } = exportMemory();
  return {
    kind: KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      cue: s.cue,
      confidenceThreshold: s.confidenceThreshold,
      proofread: s.proofread,
      termLists: s.termLists,
      presets: s.presets,
    },
    memory: { people, fixes },
  };
}

export const isSettingsFile = (data) => data?.kind === KIND;

// Layout and proofreading are replaced; term lists and presets are merged (same id replaced,
// new ones added, the editor's own kept); learned fixes and people merge like a memory import.
export function importTeamSettings(data) {
  if (!isSettingsFile(data) || !data.settings || typeof data.settings !== 'object') throw badRequest('This is not a settings file exported from Grok Transcriber.');
  const incoming = data.settings;
  const current = store.getSettings();
  const merge = (mine, theirs) => {
    if (!Array.isArray(theirs)) return mine;
    const byId = new Map(mine.map((x) => [x.id, x]));
    for (const item of theirs) byId.set(item.id, item);
    return [...byId.values()];
  };
  const patch = {};
  if (incoming.cue) patch.cue = incoming.cue;
  if (incoming.confidenceThreshold != null) patch.confidenceThreshold = incoming.confidenceThreshold;
  if (incoming.proofread) patch.proofread = incoming.proofread;
  patch.termLists = merge(current.termLists, incoming.termLists);
  patch.presets = merge(current.presets, incoming.presets);
  validateSettings(patch);
  store.saveSettings(patch);
  let people = 0, fixes = 0;
  if (data.memory) ({ people, fixes } = importMemory({ kind: 'grok-transcriber-memory', ...data.memory }));
  return {
    imported: [
      'subtitle layout',
      'proofreading',
      `${plural(Array.isArray(incoming.termLists) ? incoming.termLists.length : 0, 'term list')}`,
      `${plural(Array.isArray(incoming.presets) ? incoming.presets.length : 0, 'preset')}`,
      `${plural(people, 'new person', 'new people')}`,
      `${plural(fixes, 'new learned fix', 'new learned fixes')}`,
    ].filter((item) => !item.startsWith('0 ')),
  };
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const TEAM_ENV_NAMES = ENV_NAMES;
