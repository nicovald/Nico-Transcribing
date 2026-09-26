import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useApp } from './App.jsx';
import { desktop, Icon, Progress } from './shared.jsx';

const TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=Grok+Transcriber+updates&description=Lets+Grok+Transcriber+download+new+versions&expires_in=none';

export function updateMessage(u) {
  switch (u?.status) {
    case 'dev': return 'Running from source: updates come from git pull, not here.';
    case 'unsupported': return 'Updates are only available in the desktop app.';
    case 'no-token': return 'Paste a GitHub access token to turn on updates.';
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
    try {
      if (token !== settings.keys.github) {
        await api.put('/api/settings', { keys: { github: token } });
        await reloadSettings();
      }
      setUpdate(await api.post('/api/update/check'));
    } finally {
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
          <strong className="grow">GitHub access token</strong>
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
          On the GitHub page: Repository access → Only select repositories → <b>Video-Transcribing</b>. Permissions → Contents → <b>Read-only</b>. Generate, then paste it here.
        </span>
      </label>
      <div className={`update-status ${update?.status === 'error' ? 'error-text' : ''}`}>{updateMessage(update)}</div>
      {update?.status === 'downloading' && <Progress value={update.progress} />}
      {update?.status === 'ready' && (
        <button type="button" className="primary" onClick={() => api.post('/api/update/install')}>
          Restart and update to {update.version}
        </button>
      )}
    </section>
  );
}
