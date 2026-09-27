import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useApp } from './App.jsx';
import { desktop, Icon, Progress } from './shared.jsx';
import useUnsaved from './useUnsaved.js';

const TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=Nico%27s+Transcriber+updates&description=Lets+Nico%27s+Transcriber+download+new+versions&expires_in=none';

export function updateMessage(u) {
  switch (u?.status) {
    case 'dev': return 'Running from source: updates come from git pull, not here.';
    case 'unsupported': return 'Updates are only available in the desktop app.';
    case 'checking': return 'Checking for updates…';
    case 'downloading': return `Downloading version ${u.version}…`;
    case 'ready': return `Version ${u.version} is downloaded and ready.`;
    case 'current': return `You're on the latest version.${u.checkedAt ? ` Checked ${new Date(u.checkedAt).toLocaleTimeString()}.` : ''}`;
    case 'error': return u.error;
    default: return 'Checks for updates automatically on start and every few hours.';
  }
}

export default function Updates() {
  const { settings, reloadSettings } = useApp();
  const [update, setUpdate] = useState(null);
  const [token, setToken] = useState(settings.keys.github || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useUnsaved(token !== settings.keys.github || busy);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const u = await api.get('/api/update').catch(() => null);
      if (!stop) setUpdate(u);
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const saveAndCheck = async () => {
    setBusy(true);
    setError(null);
    try {
      if (token !== settings.keys.github) {
        const saved = await api.put('/api/settings', { keys: { github: token } });
        setToken(saved.keys.github);
        await reloadSettings();
      }
      setUpdate(await api.post('/api/update/check'));
    } catch (err) { setError(err.message); } finally {
      setBusy(false);
    }
  };

  const openLink = (e) => {
    if (desktop) {
      e.preventDefault();
      desktop.openExternal(TOKEN_URL);
    }
  };

  return (
    <section className="card">
      <div className="row">
        <h2 className="grow">Updates</h2>
        <span className="muted small">Version {update?.current ?? __APP_VERSION__}</span>
      </div>
      <label>
        <span className="row">
          <strong className="grow">GitHub access token <span className="hint-inline">optional</span></strong>
          <a href={TOKEN_URL} target="_blank" rel="noreferrer" className="small" onClick={openLink}>Create one <Icon name="external" size={12} /></a>
        </span>
        <div className="row">
          <input
            className="grow"
            type="password"
            autoComplete="off"
            value={token}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_…"
          />
          <button type="button" onClick={saveAndCheck} disabled={busy || update?.status === 'checking' || update?.status === 'downloading'}>
            {token !== settings.keys.github ? 'Save & check' : 'Check now'}
          </button>
        </div>
        <span className="hint">
          Not needed: updates come from the public GitHub releases. Only add one if the releases are private (Repository access → <b>Video-Transcribing</b>, Contents → <b>Read-only</b>).
        </span>
      </label>
      <div className={`update-status ${update?.status === 'error' ? 'error-text' : ''}`}>{updateMessage(update)}</div>
      {error && <div className="error">{error}</div>}
      {update?.status === 'downloading' && <Progress value={update.progress} />}
      {update?.status === 'ready' && (
        <button type="button" className="primary" onClick={() => api.post('/api/update/install').catch(err => setError(err.message))}>
          Restart and update to {update.version}
        </button>
      )}
    </section>
  );
}
