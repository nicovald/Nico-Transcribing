// Team mode (PROXY_SECRET set): only the proxy or a signed audio link may reach the API.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'transcriber-cloud-test-'));
const SECRET = 'test-secret-value';
process.env.DATA_DIR = path.join(temp, 'data');
process.env.PROXY_SECRET = SECRET;
process.env.APP_COMMIT = 'abc123';
const store = await import('./store.js');
const cloud = await import('./cloud.js');
const { app } = await import('./index.js');
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(temp, { recursive: true, force: true }); });

const base = () => `http://127.0.0.1:${server.address().port}`;
const proxied = { 'x-proxy-secret': SECRET, 'x-forwarded-host': 'transcriber.example.dev' };

test('requests without the proxy secret are refused', async () => {
  assert.equal((await fetch(`${base()}/api/version`)).status, 403);
  assert.equal((await fetch(`${base()}/api/version`, { headers: { 'x-proxy-secret': 'wrong-secret-val' } })).status, 403);
  const ok = await fetch(`${base()}/api/version`, { headers: proxied });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json().then(v => [v.team, v.commit]), [true, 'abc123']);
});

test('origin must match the team site, not the sandbox host', async () => {
  const post = origin => fetch(`${base()}/api/terms/parse`, { method: 'POST', headers: { ...proxied, origin, 'content-type': 'application/json' }, body: '{"text":"a"}' });
  assert.equal((await post('https://transcriber.example.dev')).status, 200);
  assert.equal((await post('https://evil.example.com')).status, 403);
});

test('audio needs a valid, unexpired signature', async () => {
  const media = { id: crypto.randomUUID(), projectId: null, name: 'a.wav', displayName: 'a', status: 'ready', tracks: [], createdAt: new Date().toISOString() };
  store.saveMedia(media);
  fs.writeFileSync(path.join(store.mediaDir(media.id), 'track-0.flac'), 'fLaC');
  const route = `/api/media/${media.id}/tracks/0/audio`;
  assert.equal((await fetch(base() + cloud.signedPath(route, SECRET))).status, 200);
  assert.equal((await fetch(base() + cloud.signedPath(route, 'other-secret'))).status, 403);
  assert.equal((await fetch(base() + cloud.signedPath(route, SECRET, -10))).status, 403);
  // A signature for one track does not open another route.
  const signed = cloud.signedPath(route, SECRET);
  assert.equal((await fetch(base() + signed.replace('/audio', '/../../version'))).status, 403);
  assert.equal((await fetch(`${base()}/api/projects${signed.slice(route.length)}`)).status, 403);
});

test('only our private upload folder can be imported', async () => {
  const project = { id: crypto.randomUUID(), name: 'P', context: '', createdAt: new Date().toISOString() };
  store.saveProject(project);
  const post = url => fetch(`${base()}/api/projects/${project.id}/import-blob`, { method: 'POST', headers: { ...proxied, 'content-type': 'application/json' }, body: JSON.stringify({ url, name: 'v.mp4' }) });
  for (const url of ['http://x.private.blob.vercel-storage.com/uploads/a/v.mp4', 'https://evil.com/uploads/a/v.mp4', 'https://x.private.blob.vercel-storage.com/other/v.mp4', 'file:///etc/passwd']) {
    assert.equal((await post(url)).status, 400, url);
  }
  assert.ok(cloud.checkBlobUrl('https://abc.private.blob.vercel-storage.com/uploads/1234/My%20Video.mp4'));
});

test('downloadBlob streams to disk with progress and the token', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'tok';
  const body = Buffer.alloc(256 * 1024, 7);
  let auth;
  const src = http.createServer((req, res) => { auth = req.headers.authorization; res.setHeader('content-length', body.length); res.end(body); });
  src.listen(0, '127.0.0.1');
  await once(src, 'listening');
  try {
    const dest = path.join(temp, 'dl.bin');
    let last = 0;
    await cloud.downloadBlob(`http://127.0.0.1:${src.address().port}/x`, dest, { onProgress: p => { last = p; } });
    assert.equal(auth, 'Bearer tok');
    assert.equal(fs.statSync(dest).size, body.length);
    assert.equal(last, 1);
  } finally { src.close(); }
});
