// Self-update from GitHub Releases. Public releases need no token; a token saved in Settings is
// used when present (a private repo, or to avoid GitHub's anonymous rate limit).
// Updates download in the background; the UI shows "Restart to update" when one is ready.
import { app } from 'electron';
import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;

export const REPO = { owner: 'nicovald', repo: 'Video-Transcribing' };
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export function createUpdater(getToken, prepareExit = async () => true) {
  let state = { status: app.isPackaged ? 'idle' : 'dev', version: null, progress: null, error: null, checkedAt: null };
  const set = (patch) => {
    state = { ...state, ...patch };
  };

  autoUpdater.autoDownload = true;
  // Never install from a screenshot/smoke-test run; those quit automatically.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, progress: 0 }));
  autoUpdater.on('update-not-available', () => set({ status: 'current', checkedAt: new Date().toISOString() }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: p.percent / 100 }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 1 }));
  autoUpdater.on('error', (err) => set({ status: 'error', error: friendly(err) }));

  let lastFeed = null;
  async function check() {
    if (!app.isPackaged) return state;
    if (state.status === 'downloading' || state.status === 'ready') return state;
    const token = getToken();
    const feed = token ? { provider: 'github', ...REPO, private: true, token } : { provider: 'github', ...REPO };
    if ((token || 'public') !== lastFeed) {
      autoUpdater.setFeedURL(feed);
      lastFeed = token || 'public';
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      set({ status: 'error', error: friendly(err) });
    }
    return state;
  }

  setTimeout(check, 10_000);
  setInterval(check, CHECK_EVERY_MS);

  return {
    status: () => ({ ...state, current: app.getVersion() }),
    check: async () => ({ ...(await check()), current: app.getVersion() }),
    install: async () => {
      if (state.status !== 'ready' || process.env.SCREENSHOT || !(await prepareExit())) return false;
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
      return true;
    },
  };
}

function friendly(err) {
  const msg = String(err?.message || err);
  if (/401|Bad credentials/i.test(msg)) return 'GitHub rejected the access token. Check it in Settings.';
  if (/404/.test(msg)) return "Couldn't see the releases. If the repo is private, add a GitHub token with access to Video-Transcribing (Contents: read).";
  if (/403|rate limit/i.test(msg)) return 'GitHub is limiting update checks right now; will try again later.';
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::/i.test(msg)) return 'No internet connection, will try again later.';
  return msg.split('\n')[0].slice(0, 200);
}
