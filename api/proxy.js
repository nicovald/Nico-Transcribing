// Every /api request from the team site lands here (see vercel.json) and is passed to the sandbox
// server. Vercel Authentication has already checked who the visitor is before this runs.
import { signedPath } from '../server/cloud.js';
import { SECRET, ensureServer } from './_sandbox.js';

const AUDIO = /^\/api\/media\/[^/]+\/tracks\/\d+\/audio$/;
// Hop-by-hop and Vercel-internal headers are not forwarded.
const SKIP_IN = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'x-proxy-secret', 'cookie']);
const SKIP_OUT = new Set(['connection', 'content-length', 'content-encoding', 'transfer-encoding', 'keep-alive']);

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export default async function handler(req, res) {
  const original = new URL(req.url, 'http://x');
  const route = original.searchParams.get('__path') || '';
  original.searchParams.delete('__path');
  const path = `/api/${route}`;
  const query = original.searchParams.toString();
  try {
    const base = await ensureServer();
    // Review audio is tens of MB, more than a function can return; the player fetches it directly.
    if (req.method === 'GET' && AUDIO.test(path)) {
      res.statusCode = 302;
      res.setHeader('location', base + signedPath(path, SECRET));
      res.setHeader('cache-control', 'private, no-store');
      return res.end();
    }
    const headers = { 'x-proxy-secret': SECRET, 'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers.host };
    for (const [k, v] of Object.entries(req.headers)) if (!SKIP_IN.has(k) && !k.startsWith('x-vercel') && !k.startsWith('x-forwarded') && v != null) headers[k] = v;
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
    const upstream = await fetch(`${base}${path}${query ? `?${query}` : ''}`, { method: req.method, headers, body, redirect: 'manual' });
    res.statusCode = upstream.status;
    upstream.headers.forEach((v, k) => { if (!SKIP_OUT.has(k)) res.setHeader(k, v); });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error('proxy:', err);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: `The transcriber is waking up or unavailable. Please try again in a moment. (${err.message})` }));
  }
}
