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
  const res = await undiciFetch(url, { ...init, signal, dispatcher });
  const body = await res.text();
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    // Non-JSON error pages are reported as text below.
  }
  if (!res.ok) {
    const detail = json?.error?.message || json?.error || json?.detail?.message || json?.detail || json?.err_msg || json?.message || body.slice(0, 300);
    const err = new Error(`HTTP ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    err.status = res.status;
    throw err;
  }
  return json;
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
