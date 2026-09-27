// Desktop shell: runs the Express server in-process on a random local port and
// shows the UI in a native window. Files are read in place (no copying).
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell, safeStorage, screen } from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url));

// Screenshot smoke tests get their own profile so they can run next to a real window.
if (process.env.SCREENSHOT) app.setPath('userData', path.join(path.dirname(path.resolve(process.env.SCREENSHOT)), '.electron-profile'));

// The app was called "Grok Transcriber" before v0.14. Installs from then keep their folder: it holds
// the projects and the Windows key that unlocks the saved API keys, so moving it would lose them.
const legacyUserData = path.join(app.getPath('appData'), 'Grok Transcriber');
if (app.isPackaged && !process.env.SCREENSHOT && fs.existsSync(legacyUserData)) app.setPath('userData', legacyUserData);

// Only one copy of the app at a time; a second launch focuses the first window.
if (!app.requestSingleInstanceLock()) {
  console.log("Nico's Transcriber is already running; focusing that window instead.");
  app.exit(0);
}

// Packaged: keep data in %APPDATA%/Nico's Transcriber (or the legacy folder above). Dev (npm run app): use the repo's ./data.
process.env.DATA_DIR ??= app.isPackaged ? path.join(app.getPath('userData'), 'data') : path.join(here, '..', 'data');

// Screenshot smoke tests run without a GPU.
if (process.env.SCREENSHOT) app.disableHardwareAcceleration();

let win = null;
let allowExit = false;
let exitTask = null;
const dirty = new Set();
ipcMain.on('unsaved', (event, id, value) => {
  if (event.sender !== win?.webContents || typeof id !== 'string') return;
  value ? dirty.add(id) : dirty.delete(id);
});

const VIDEO_FILTERS = [
  { name: 'Video & audio', extensions: ['mp4', 'mov', 'mkv', 'm4v', 'avi', 'webm', 'mxf', 'wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg'] },
  { name: 'All files', extensions: ['*'] },
];

ipcMain.handle('pick-videos', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Choose videos', properties: ['openFile', 'multiSelections'], filters: VIDEO_FILTERS });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Save subtitles to…', properties: ['openDirectory', 'createDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('show-item', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('open-external', (e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

async function createWindow() {
  const { getSettings, configureSecrets } = await import('../server/store.js');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows key protection is unavailable. Sign into Windows again and restart Nico\'s Transcriber.');
  configureSecrets({
    encrypt: text => safeStorage.encryptString(text).toString('base64'),
    decrypt: text => safeStorage.decryptString(Buffer.from(text, 'base64')),
  });
  const { startServer, setUpdater, configureDesktop, activity, shutdown } = await import('../server/index.js');
  const token = randomUUID();
  configureDesktop(token);
  async function prepareExit() {
    if (allowExit) return true;
    if (exitTask) return exitTask;
    exitTask = (async () => {
      const work = activity();
      const count = work.jobs + work.imports + work.checks;
      if (!process.env.SCREENSHOT && (count || dirty.size)) {
        const result = await dialog.showMessageBox(win, {
          type: 'warning', title: "Close Nico's Transcriber?",
          message: count ? 'Work is still in progress.' : 'You have unsaved changes.',
          detail: `${count ? 'Closing stops active imports, transcriptions and checks. Completed transcription chunks are kept for retry. ' : ''}${dirty.size ? 'Unsaved edits will be lost. ' : ''}Keep the app open to finish.`,
          buttons: ['Keep working', 'Stop and close'], defaultId: 0, cancelId: 0,
        });
        if (result.response !== 1) return false;
      }
      await shutdown();
      allowExit = true;
      return true;
    })().finally(() => { exitTask = null; });
    return exitTask;
  }
  const { createUpdater } = await import('./updater.js');
  setUpdater(createUpdater(() => getSettings().keys.github, prepareExit));
  const port = await startServer({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${port}`;
  const boundsFile = path.join(app.getPath('userData'), 'window.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(boundsFile, 'utf8')); } catch {}
  const display = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: Math.min(Number(process.env.SCREENSHOT_WIDTH) || saved.width || 1280, display.width),
    height: Math.min(saved.height || 900, display.height),
    minWidth: 960,
    minHeight: 650,
    show: !process.env.SCREENSHOT,
    title: "Nico's Transcriber",
    backgroundColor: '#f3f8fc',
    autoHideMenuBar: true,
    // Our own title bar: the page runs to the top edge, Windows keeps the real
    // minimize/maximize/close buttons (and snap layouts) tinted to match the app.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f3f8fc', symbolColor: '#0f2a44', height: 36 },
    icon: path.join(here, 'icon.png'),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      // Screenshot runs render offscreen so capture works even when the desktop is locked or covered.
      offscreen: Boolean(process.env.SCREENSHOT),
    },
  });
  if (saved.maximized && !process.env.SCREENSHOT) win.maximize();
  win.on('close', e => {
    if (allowExit) return;
    e.preventDefault();
    if (!process.env.SCREENSHOT) {
      const bounds = win.getNormalBounds();
      try { fs.writeFileSync(boundsFile, JSON.stringify({ width: bounds.width, height: bounds.height, maximized: win.isMaximized() })); } catch {}
    }
    prepareExit().then(ok => { if (ok) win.close(); }).catch(err => dialog.showErrorBox('Could not finish closing', err.message));
  });
  await win.webContents.session.cookies.set({ url: origin, name: 'desktop-session', value: token, httpOnly: true, sameSite: 'strict' });
  const isLocal = url => { try { return new URL(url).origin === origin; } catch { return false; } };

  // Links to other sites (e.g. "Get a key") open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isLocal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isLocal(url)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  // SRT "Download" links: ask where to save, starting in Downloads.
  win.webContents.session.on('will-download', (e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });

  await win.loadURL(origin);

  // Smoke test hook: SCREENSHOT=<file> captures the window and exits.
  if (process.env.SCREENSHOT) {
    setTimeout(async () => {
      try {
        if (process.env.SCREENSHOT_HASH) await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(process.env.SCREENSHOT_HASH)}`);
        await new Promise((r) => setTimeout(r, 1500));
        if (process.env.SCREENSHOT_JS) {
          const result = await win.webContents.executeJavaScript(process.env.SCREENSHOT_JS);
          if (result !== undefined) fs.writeFileSync(`${process.env.SCREENSHOT}.json`, JSON.stringify(result, null, 2));
          await new Promise((r) => setTimeout(r, 800));
        }
        const img = await win.webContents.capturePage();
        (await import('node:fs')).writeFileSync(process.env.SCREENSHOT, img.toPNG());
      } catch (err) {
        console.error('Screenshot failed:', err);
        app.exit(1);
        return;
      }
      app.quit();
    }, Number(process.env.SCREENSHOT_DELAY) || 2500);
  }
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(createWindow).catch((err) => {
  console.error(err);
  if (process.env.SCREENSHOT) { app.exit(1); return; }
  dialog.showErrorBox("Nico's Transcriber failed to start", String(err?.stack || err));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
