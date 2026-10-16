// Team mode (Vercel): the transcriber server runs unchanged inside one persistent Vercel Sandbox.
// Its data lives on a Drive mounted at /data; the sandbox sleeps when idle and resumes on the next
// request. Files starting with "_" are helpers, not routes.
import { Drive, Sandbox } from '@vercel/sandbox';

const ENV = process.env.VERCEL_ENV || 'development';
const PORT = 3462;
const APP_DIR = '/vercel/app';
const REPO = 'https://github.com/nicovald/Nico-Transcribing.git';
// Deploy builds from Git, so the sandbox runs exactly the commit this deployment was built from.
export const COMMIT = process.env.VERCEL_GIT_COMMIT_SHA || 'main';
export const SECRET = process.env.PROXY_SECRET || '';
const SESSION = 30 * 60 * 1000; // idle sessions stop after this; each request or busy check extends it
// Vercel still limits this team's Drive storage to 15 GiB in total; move to a larger drive once that lifts.
const DRIVE_BYTES = (ENV === 'production' ? 13 : 1) * 1024 ** 3;

const names = { sandbox: `transcriber-${ENV}`, drive: `transcriber-data-${ENV}` };
let warm = null; // { url, until } cached across requests on the same function instance

const wait = ms => new Promise(r => setTimeout(r, ms));

async function version(url, ms = 3000) {
  try {
    const res = await fetch(`${url}/api/version`, { headers: { 'x-proxy-secret': SECRET }, signal: AbortSignal.timeout(ms) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export async function activity(url) {
  try {
    const res = await fetch(`${url}/api/activity`, { headers: { 'x-proxy-secret': SECRET }, signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
export const busy = a => Boolean(a && (a.jobs || a.imports || a.checks));

async function sh(sandbox, script, env = {}) {
  const r = await sandbox.runCommand({ cmd: 'bash', args: ['-c', script], env });
  if (r.exitCode) throw new Error(`Sandbox setup failed: ${((await r.stderr()) || (await r.stdout())).slice(-800)}`);
}

// One-time tools plus the app at COMMIT. flock keeps two waking requests from installing at once.
const INSTALL = `set -eo pipefail
exec 9>/tmp/install.lock; flock 9
command -v ffmpeg >/dev/null || { sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg >/dev/null; }
[ "$(cat ${APP_DIR}/.commit 2>/dev/null)" = "$COMMIT" ] && exit 0
rm -rf ${APP_DIR}.new && mkdir -p ${APP_DIR}.new && cd ${APP_DIR}.new
git init -q && git remote add origin ${REPO}
git fetch -q --depth 1 origin "$COMMIT" && git checkout -q FETCH_HEAD
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null
echo "$COMMIT" > .commit
pkill -f "node [s]erver/index.js" || true
rm -rf ${APP_DIR}.old; [ -d ${APP_DIR} ] && mv ${APP_DIR} ${APP_DIR}.old; mv ${APP_DIR}.new ${APP_DIR}`;

function serverEnv() {
  return {
    HOST: '0.0.0.0', PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: '/data',
    FFMPEG_PATH: '/usr/bin/ffmpeg', FFPROBE_PATH: '/usr/bin/ffprobe',
    PROXY_SECRET: SECRET, APP_COMMIT: COMMIT,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN || '',
  };
}

export async function getSandbox({ resume = true } = {}) {
  const drive = await Drive.getOrCreate({ name: names.drive, maxSize: DRIVE_BYTES });
  return Sandbox.getOrCreate({
    name: names.sandbox,
    resume,
    resources: { vcpus: 2 },
    ports: [PORT],
    timeout: SESSION,
    mounts: { '/data': drive },
    keepLastSnapshots: { count: 1 },
  });
}

export async function keepAwake(sandbox, ms = SESSION) {
  const left = (sandbox.expiresAt?.getTime() ?? 0) - Date.now();
  if (left < ms * 0.66) await sandbox.extendTimeout(ms - Math.max(left, 0)).catch(err => console.warn('extendTimeout:', err.message));
}

// Returns the sandbox server's base URL, waking the sandbox and (re)starting the app as needed.
export async function ensureServer() {
  if (!SECRET) throw new Error('PROXY_SECRET is not set for this deployment.');
  if (warm && warm.until > Date.now()) return warm.url;
  const sandbox = await getSandbox();
  const url = sandbox.domain(PORT);
  let v = await version(url);
  // A newer deployment waits until running transcriptions finish, so nobody's job is cut off.
  const stale = v && v.commit !== COMMIT && !busy(await activity(url));
  if (!v || stale) {
    await sh(sandbox, INSTALL, { COMMIT });
    if (!(v = await version(url, 1500)) || v.commit !== COMMIT) {
      await sandbox.runCommand({ cmd: 'node', args: ['server/index.js'], cwd: APP_DIR, env: serverEnv(), detached: true });
      for (let i = 0; i < 60 && !(v = await version(url, 1500)); i++) await wait(500);
      if (!v) throw new Error('The transcriber did not start. Please try again in a minute.');
    }
  }
  await keepAwake(sandbox);
  warm = { url, until: Date.now() + 30_000 };
  return url;
}
