// Shared HTTP helpers for provider adapters.
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { Agent, fetch as undiciFetch, FormData } from 'undici';

// Batch transcription of long audio can take many minutes before the first
// response byte, so lift undici's default 5-minute header/body timeouts.
const dispatcher = new Agent({ headersTimeout: 60 * 60 * 1000, bodyTimeout: 60 * 60 * 1000, connectTimeout: 30_000 });

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

// Parse the comma/newline separated keyterm setting into a clean list.
export function parseKeyterms(raw, { max = 100, maxLen = 50 } = {}) {
  return String(raw || '')
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter((t) => t && t.length <= maxLen)
    .slice(0, max);
}
