// Desktop shell: runs the Express server in-process on a random local port and
// shows the UI in a native window. Files are read in place (no copying).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url));

// Screenshot smoke tests get their own profile so they can run next to a real window.
if (process.env.SCREENSHOT) app.setPath('userData', path.join(app.getPath('temp'), 'grok-transcriber-screenshot'));

// Only one copy of the app at a time; a second launch focuses the first window.
if (!app.requestSingleInstanceLock()) {
  console.log('Grok Transcriber is already running; focusing that window instead.');
  app.quit();
}

// Packaged: keep data in %APPDATA%/Grok Transcriber. Dev (npm run app): use the repo's ./data.
process.env.DATA_DIR ??= app.isPackaged ? path.join(app.getPath('userData'), 'data') : path.join(here, '..', 'data');

// Screenshot smoke tests run without a GPU.
if (process.env.SCREENSHOT) app.disableHardwareAcceleration();

let win = null;

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
  const { startServer, setUpdater } = await import('../server/index.js');
  const { getSettings } = await import('../server/store.js');
  const { createUpdater } = await import('./updater.js');
  setUpdater(createUpdater(() => getSettings().keys.github));
  const port = await startServer({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${port}`;

  win = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 420,
    minHeight: 500,
    title: 'Grok Transcriber',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    icon: path.join(here, 'icon.png'),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Links to other sites (e.g. "Get a key") open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
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
          await win.webContents.executeJavaScript(process.env.SCREENSHOT_JS);
          await new Promise((r) => setTimeout(r, 800));
        }
        const img = await win.webContents.capturePage();
        (await import('node:fs')).writeFileSync(process.env.SCREENSHOT, img.toPNG());
      } catch (err) {
        console.error('Screenshot failed:', err);
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
  dialog.showErrorBox('Grok Transcriber failed to start', String(err?.stack || err));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
