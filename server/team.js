// Team setup: a studio hands editors a .env file with the API keys it pays for.
// Opened with Ctrl+Shift+T in the app. Values are stored like typed keys and never sent back.
// The file can be password-locked (AES-256-GCM, scrypt key) so it is safe to send around.
import crypto from 'node:crypto';
import { badRequest } from './validation.js';

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

// ---------------------------------------------------------------- locked files

const KIND = 'grok-transcriber-team-setup';
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const deriveKey = (password, salt) => crypto.scryptSync(String(password), salt, 32, SCRYPT);

export function lockTeamEnv(text, password) {
  if (!parseTeamEnv(text).services.length) throw badRequest('No API keys found in that file. Lines should look like XAI_API_KEY=your-key.');
  if (typeof password !== 'string' || password.length < 8) throw badRequest('Use a password of at least 8 characters.');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const b64 = (b) => b.toString('base64');
  return { kind: KIND, version: 1, cipher: 'aes-256-gcm/scrypt', salt: b64(salt), iv: b64(iv), tag: b64(cipher.getAuthTag()), data: b64(data) };
}

const lockedFile = (text) => {
  try {
    const f = JSON.parse(text);
    return f?.kind === KIND ? f : null;
  } catch {
    return null;
  }
};

// The .env text from a plain or locked file. Locked without a password: error with needsPassword.
export function openTeamFile(text, password) {
  const f = lockedFile(text);
  if (!f) return String(text);
  if (!password) throw Object.assign(badRequest('This setup file is locked. Enter the password you were given.'), { needsPassword: true });
  try {
    const b = (s) => Buffer.from(String(s), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, b(f.salt)), b(f.iv));
    decipher.setAuthTag(b(f.tag));
    return Buffer.concat([decipher.update(b(f.data)), decipher.final()]).toString('utf8');
  } catch {
    throw Object.assign(badRequest('That password does not unlock this file.'), { needsPassword: true });
  }
}

export const TEAM_ENV_NAMES = ENV_NAMES;
