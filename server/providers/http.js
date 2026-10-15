// Shared HTTP helpers for provider adapters.
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { Agent, fetch as undiciFetch, FormData } from 'undici';

// Batch transcription of long audio can take many minutes before the first
// response byte, so lift undici's default 5-minute header/body timeouts.
let dispatcher = new Agent({ headersTimeout: 60 * 60 * 1000, bodyTimeout: 60 * 60 * 1000, connectTimeout: 30_000 });

// Tests swap in an undici MockAgent to check request bodies without network calls.
export const setDispatcher = (d) => { dispatcher = d; };

export { FormData };

export async function fileBlob(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = { flac: 'audio/flac', mp3: 'audio/mpeg', wav: 'audio/wav' }[ext] || 'application/octet-stream';
  return openAsBlob(file, { type });
}

export async function request(url, { signal, ...init } = {}) {
  let res;
  try {
    res = await undiciFetch(url, { ...init, signal, dispatcher });
  } catch (err) {
    if (signal?.aborted) throw err;
    // Network-level failure (offline, DNS, timeout): still say which service.
    throw new Error(`Couldn't reach ${serviceName(url)}. Check your internet connection and try again. (${err.cause?.code || err.cause?.message || err.message})`);
  }
  const body = await res.text();
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    // Non-JSON error pages are reported as text below.
  }
  if (!res.ok) {
    const detail = json?.error?.message || json?.error || json?.detail?.message || json?.detail || json?.err_msg || json?.message || body.slice(0, 300);
    const err = new Error(describeError(url, res.status, typeof detail === 'string' ? detail : JSON.stringify(detail)));
    err.status = res.status;
    throw err;
  }
  return json;
}

// Where each provider's billing lives, so "out of credits" errors say whose credits.
const services = {
  'api.x.ai': { name: 'Grok (xAI)', url: 'console.x.ai → Billing' },
  'api.openai.com': { name: 'OpenAI', url: 'platform.openai.com/settings/organization/billing' },
  'api.deepgram.com': { name: 'Deepgram', url: 'console.deepgram.com → Billing' },
  'api.assemblyai.com': { name: 'AssemblyAI', url: 'assemblyai.com/dashboard → Billing' },
  'api.elevenlabs.io': { name: 'ElevenLabs', url: 'elevenlabs.io/app/subscription' },
  'api.anthropic.com': { name: 'Claude (Anthropic)', url: 'platform.claude.com → Billing' },
  'api.typesafe.ai': { name: 'TypeSafe (Jev)' },
  'raw.githubusercontent.com': { name: 'GitHub' },
};

export function serviceName(url) {
  let host = '';
  try { host = new URL(url).host; } catch {}
  return services[host]?.name || host || 'The provider';
}

// Every API error starts with the service's name, so editors know which one failed.
// Billing/quota and rate-limit errors get a plain sentence instead of the raw text.
export function describeError(url, status, detail) {
  const raw = `HTTP ${status}: ${detail}`;
  let host = '';
  try { host = new URL(url).host; } catch {}
  const svc = services[host];
  const name = serviceName(url);
  const isRate = /rate limit|per minute|too many requests/i.test(detail);
  const isBilling = status === 402 || (/credit|spending limit|spend limit|quota|billing|balance|insufficient funds/i.test(detail) && !isRate);
  if (isBilling) {
    const where = svc?.url ? ` Add credits or raise the limit at ${svc.url}.` : '';
    // xAI sends one message for both cases (plus a team ID), so say that plainly instead.
    if (host === 'api.x.ai' && /spending limit/i.test(detail) && /credits/i.test(detail)) {
      return `${name} account is out of prepaid credits or hit its monthly spending limit (xAI doesn't say which).${where}`;
    }
    return `${name} account is out of credits or over its spending limit.${where} (${raw})`;
  }
  if (status === 429 || isRate) return `${name} is rate-limiting requests (too many at once). Wait a minute and retry. (${raw})`;
  if (status === 401) return `${name} rejected the API key. Check it in Settings. (${raw})`;
  if (status >= 500) return `${name} is having server trouble right now. Try again later. (${raw})`;
  return `${name}: ${raw}`;
}

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Aborted'));
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const t = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('Aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });

// Split a comma/newline separated keyterm setting (or an array of terms) into clean terms.
// Double quotes keep a comma inside one term: "Bucket of Salmon, Raw", Sundee.
export function splitKeyterms(raw) {
  if (Array.isArray(raw)) return raw.map((t) => String(t ?? '').trim()).filter(Boolean);
  const text = String(raw || '');
  // An unmatched quote would swallow everything after it, so then split plainly.
  if ((text.match(/"/g) || []).length % 2) return text.split(/[,\r\n]/).map((t) => t.trim()).filter(Boolean);
  const out = [];
  let term = '';
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && /[,\r\n]/.test(ch)) { out.push(term); term = ''; }
    else term += ch;
  }
  out.push(term);
  return out.map((t) => t.trim()).filter(Boolean);
}

// Conservative token count for budget checks (meant as an upper bound, not an average):
// each run of ASCII letters costs the larger of ceil(len/3) and one token per vowel group and per
// consonant cluster (a cluster over 3 letters, like the "qzqz" in a handle, costs one per letter
// because no merge exists for it), every digit or ASCII symbol costs 1, any other
// character costs its UTF-8 byte length (a byte-level tokenizer never needs more), and a single
// space is free (it merges into the next piece). So a handle like "X10Y10Z10" costs 9, not 3.
const letterRunTokens = (run) => {
  let clusters = 0;
  for (const [g] of run.matchAll(/[aeiouy]+|[^aeiouy]+/gi)) clusters += /^[aeiouy]/i.test(g) || g.length <= 3 ? 1 : g.length;
  return Math.max(Math.ceil(run.length / 3), clusters);
};
export function countTokens(text) {
  let n = 0;
  for (const [piece] of String(text ?? '').matchAll(/[A-Za-z]+|[\s\S]/gu)) {
    if (piece === ' ') continue;
    if (/^[A-Za-z]/.test(piece)) n += letterRunTokens(piece);
    else if (piece.length === 1 && piece.charCodeAt(0) < 128) n += 1;
    else n += Buffer.byteLength(piece, 'utf8');
  }
  return n;
}

// A term's cost inside a list: its tokens plus one for the separator.
export const estimateTokens = (term) => countTokens(term) + 1;

// A provider declares its keyterm rules as `keyterms: { max, maxChars, maxWords, maxTokens, overheadTokens, banned }`,
// or as a function of the model when they differ per model. overheadTokens is fixed text sent
// with the list (e.g. a prompt prefix) that counts against maxTokens.
export const keytermLimits = (provider, model, options = {}) =>
  (typeof provider?.keyterms === 'function' ? provider.keyterms(model || '', options) : provider?.keyterms) || {};

// Fit an ordered term list (most important first) into a provider's limits.
// Duplicates are dropped case-insensitively; terms that break a rule are skipped, and later
// shorter terms may still fill a token budget. Returns { terms, total } (total = unique terms).
export function limitKeyterms(raw, { max = Infinity, maxChars = Infinity, maxWords = Infinity, maxTokens = Infinity, overheadTokens = 0, banned = null } = {}) {
  const seen = new Set();
  const terms = [];
  let tokens = overheadTokens;
  for (const term of splitKeyterms(raw)) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (terms.length >= max) continue;
    if (term.length > maxChars || term.split(/\s+/).length > maxWords || banned?.test(term)) continue;
    const cost = estimateTokens(term);
    if (tokens + cost > maxTokens) continue;
    tokens += cost;
    terms.push(term);
  }
  return { terms, total: seen.size };
}
