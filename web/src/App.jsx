import { Component, createContext, useContext, useEffect, useState } from 'react';
import { api, uploadFile } from './api.js';
import Home from './Home.jsx';
import Project from './Project.jsx';
import Review from './Review.jsx';
import Settings from './Settings.jsx';
import { updateMessage } from './Updates.jsx';
import { desktop, Icon, Logo, Progress } from './shared.jsx';

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
  const [loadError, setLoadError] = useState(null);
  const [activity, setActivity] = useState(null);

  // Notice when a background update has finished downloading.
  useEffect(() => {
    if (!desktop) return;
    const poll = () => api.get('/api/update').then(setUpdate).catch(() => {});
    poll();
    const t = setInterval(poll, 60_000);
    return () => clearInterval(t);
  }, []);

  const loadSettings = () => api.get('/api/settings').then(setSettings);
  const initialize = async () => {
    setLoadError(null);
    try {
      const [p, s] = await Promise.all([api.get('/api/providers'), api.get('/api/settings')]);
      setProviders(p); setSettings(s);
    } catch (err) { setLoadError(err.message); }
  };
  useEffect(() => {
    initialize();
    const poll = () => api.get('/api/activity').then(setActivity).catch(() => {});
    poll();
    const timer = setInterval(poll, 2500);
    return () => clearInterval(timer);
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
  const noKeys = settings && !providers.transcribers.some(p => settings.keys[p.id]);
  const activeCount = activity ? activity.jobs + activity.imports + activity.checks : 0;

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <a className="brand" href="#/">
            <Logo /> Grok Transcriber
          </a>
          <span className="app-activity" role="status">{activeCount ? <><span className="spinner" /> {activeCount} task{activeCount === 1 ? '' : 's'} in progress</> : 'Your transcription workspace'}</span>
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
            <button className="primary small-btn" onClick={() => api.post('/api/update/install').catch(err => setLoadError(err.message))}>Restart to update</button>
          </div>
        )}

        {uploads.length > 0 && (
          <div className="uploads">
            {uploads.map((u) => (
              <div key={u.id} className="upload-row">
                <span className="grow">{u.error ? <span className="error-text">{u.name}: {u.error}</span> : `Copying ${u.name}…`}</span>
                {u.error ? (
                  <button className="icon-btn" title="Dismiss" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}><Icon name="x" /></button>
                ) : (
                  <Progress value={u.progress} />
                )}
              </div>
            ))}
          </div>
        )}

        <main>
          {loadError && <div className="error" role="alert">{loadError} <button onClick={initialize}>Try again</button></div>}
          {noKeys && section !== 'settings' && (
            <div className="banner">
              No API keys yet. <a href="#/settings">Add one in Settings</a> to start transcribing.
            </div>
          )}
          {!settings ? (
            <p className="muted">{loadError ? 'The workspace could not be loaded.' : 'Opening your workspace…'}</p>
          ) : (
            <WorkspaceBoundary>
              {/* Home and Settings stay mounted so switching tabs never loses what you were doing. */}
              <div hidden={section !== 'home'}>
                <Home active={section === 'home'} />
              </div>
              <div hidden={section !== 'settings'}>
                <Settings />
              </div>
              {section === 'projects' && route[1] && <Project key={route[1]} projectId={route[1]} />}
              {section === 'jobs' && route[1] && <Review key={route[1]} jobId={route[1]} />}
            </WorkspaceBoundary>
          )}
        </main>

        <footer>Grok Transcriber v{__APP_VERSION__} · {desktop ? 'Windows desktop' : 'Browser'} · Projects saved on this computer</footer>
      </div>
    </AppContext.Provider>
  );
}

class WorkspaceBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error: error.message }; }
  render() {
    if (this.state.error) return <div className="card stack"><h2>This view could not open</h2><p>{this.state.error}</p><button onClick={() => location.reload()}>Reload workspace</button></div>;
    return this.props.children;
  }
}
