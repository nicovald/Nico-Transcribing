// Team mode (Vercel): this server runs inside a Vercel Sandbox and is reached only through the
// app's proxy function, which sits behind Vercel Authentication. The sandbox URL itself is public,
// so the proxy secret header (or a signed audio link) is the only thing that lets a request in.
// Desktop and Docker never set PROXY_SECRET, so none of this applies to them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const PROXY_SECRET = process.env.PROXY_SECRET || '';
export const isCloud = PROXY_SECRET.length > 0;
export const UPLOAD_PREFIX = 'uploads/';

const sign = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Signed links let the browser's audio player go straight to the sandbox (audio is too big for the proxy).
export function signedPath(path, secret, ttlSeconds = 6 * 3600, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `${path}?exp=${exp}&sig=${sign(secret, `${path}:${exp}`)}`;
}
export function verifySignedPath(path, { exp, sig } = {}, secret, now = Date.now()) {
  if (!secret || !/^\d+$/.test(String(exp)) || Number(exp) * 1000 < now) return false;
  return same(String(sig), sign(secret, `${path}:${exp}`));
}

export const AUDIO_PATH = /^\/api\/media\/[^/]+\/tracks\/\d+\/audio$/;

export const fromProxy = req => same(req.headers['x-proxy-secret'], PROXY_SECRET);
export function isSignedAudio(req) {
  const path = req.baseUrl + req.path;
  return req.method === 'GET' && AUDIO_PATH.test(path) && verifySignedPath(path, req.query, PROXY_SECRET);
}

// Uploads land in private Blob storage first; only our own upload folder can be imported.
export function checkBlobUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && u.hostname.endsWith('.blob.vercel-storage.com') && decodeURIComponent(u.pathname).startsWith(`/${UPLOAD_PREFIX}`);
}

// Copy an uploaded video from Blob storage to local disk, then remove it from storage.
export async function downloadBlob(url, dest, { signal, onProgress } = {}) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('File storage is not connected. Ask your administrator to check the team setup.');
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal });
  if (!res.ok) throw new Error(`The uploaded file could not be read from storage (${res.status}). Please upload it again.`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  const body = Readable.fromWeb(res.body);
  if (onProgress && total) body.on('data', chunk => { done += chunk.length; onProgress(done / total); });
  await pipeline(body, fs.createWriteStream(dest), { signal });
}

export async function deleteBlob(url) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  const { del } = await import('@vercel/blob');
  await del(url, { token }).catch(err => console.warn('Could not remove uploaded file from storage:', err.message));
}
