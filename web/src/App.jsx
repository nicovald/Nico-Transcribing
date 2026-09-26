import { createContext, useContext, useEffect, useState } from 'react';
import { api, uploadFile } from './api.js';
import Home from './Home.jsx';
import Project from './Project.jsx';
import Review from './Review.jsx';
import Settings from './Settings.jsx';
import { updateMessage } from './Updates.jsx';
import { desktop, Progress } from './shared.jsx';

// Tiny hash router: #/, #/projects/<id>, #/jobs/<id>, #/settings
function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.slice(1).split('/').filter(Boolean);
}

export const navigate = (path) => {
  window.location.hash = path;
};

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export default function App() {
  const route = useRoute();
  const [providers, setProviders] = useState({ transcribers: [], proofreaders: [] });
  const [settings, setSettings] = useState(null);
  // Browser-mode uploads live here so they survive switching pages.
  const [uploads, setUploads] = useState([]); // { id, name, progress, error }
  const [dataVersion, setDataVersion] = useState(0);
  const [update, setUpdate] = useState(null);

  // Notice when a background update has finished downloading.
  useEffect(() => {
    if (!desktop) return;
    const poll = () => api.get('/api/update').then(setUpdate).catch(() => {});
    poll();
    const t = setInterval(poll, 60_000);
    return () => clearInterval(t);
  }, []);

  const loadSettings = () => api.get('/api/settings').then(setSettings);
  useEffect(() => {
    api.get('/api/providers').then(setProviders);
    loadSettings();
  }, []);

  const bumpData = () => setDataVersion((v) => v + 1);

  // Add video files to a project (creating one named after the first file if needed).
  // Desktop: files are read in place by path. Browser: uploaded one at a time.
  const addFiles = async (files, projectId, presetId) => {
    if (!projectId) {
      const name = files[0].name.replace(/\.[^.]+$/, '');
      projectId = (await api.post('/api/projects', { name, presetId })).id;
    }
    const paths = desktop ? files.map((f) => desktop.pathForFile(f)).filter(Boolean) : [];
    if (desktop && paths.length === files.length) {
      await api.post(`/api/projects/${projectId}/media`, { paths });
    } else {
      uploadAll(files, projectId);
    }
    bumpData();
    return projectId;
  };

  // Runs in the background; progress shows in the bar under the header on every page.
  const uploadAll = async (files, projectId) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
      try {
        await uploadFile(projectId, file, (p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))));
        setUploads((u) => u.filter((x) => x.id !== id));
      } catch (err) {
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: err.message } : x)));
      }
      bumpData();
    }
  };

  const addPaths = async (paths, projectId, presetId) => {
    if (!projectId) {
      const name = paths[0].split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
      projectId = (await api.post('/api/projects', { name, presetId })).id;
    }
    await api.post(`/api/projects/${projectId}/media`, { paths });
    bumpData();
    return projectId;
  };

  const section = route[0] || 'home';
  const ctx = { providers, settings, reloadSettings: loadSettings, addFiles, addPaths, dataVersion, bumpData };
  const noKeys = settings && !Object.entries(settings.keys).some(([id, k]) => k && id !== 'github' && id !== 'typesafe');

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <a className="brand" href="#/">
            <span className="logo">💬</span> Grok Transcriber
          </a>
          <nav>
            <a className={section === 'home' || section === 'projects' || section === 'jobs' ? 'active' : ''} href="#/">
              Projects
            </a>
            <a className={section === 'settings' ? 'active' : ''} href="#/settings">
              Settings{noKeys && <span className="dot" title="No API keys yet" />}
            </a>
          </nav>
        </header>

        {update?.status === 'ready' && (
          <div className="update-bar">
            <span className="grow">{updateMessage(update)}</span>
            <button className="primary small-btn" onClick={() => api.post('/api/update/install')}>Restart to update</button>
          </div>
        )}

        {uploads.length > 0 && (
          <div className="uploads">
            {uploads.map((u) => (
              <div key={u.id} className="upload-row">
                <span className="grow">{u.error ? `⚠ ${u.name}: ${u.error}` : `Copying ${u.name}…`}</span>
                {u.error ? (
                  <button className="ghost small-btn" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}>✕</button>
                ) : (
                  <Progress value={u.progress} />
                )}
              </div>
            ))}
          </div>
        )}

        <main>
          {noKeys && section !== 'settings' && (
            <div className="banner">
              No API keys yet. <a href="#/settings">Add one in Settings</a> to start transcribing.
            </div>
          )}
          {!settings ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              {/* Home and Settings stay mounted so switching tabs never loses what you were doing. */}
              <div hidden={section !== 'home'}>
                <Home active={section === 'home'} />
              </div>
              <div hidden={section !== 'settings'}>
                <Settings />
              </div>
              {section === 'projects' && route[1] && <Project key={route[1]} projectId={route[1]} />}
              {section === 'jobs' && route[1] && <Review key={route[1]} jobId={route[1]} />}
            </>
          )}
        </main>

        <footer>Grok Transcriber v{__APP_VERSION__}</footer>
      </div>
    </AppContext.Provider>
  );
}
