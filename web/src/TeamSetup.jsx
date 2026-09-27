import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './shared.jsx';

// Hidden on purpose (Ctrl+Shift+T): a studio gives its editors a setup file with the keys it pays for.
// Plain .env files work; "Make a locked file" turns one into a password-protected file to send around.
export default function TeamSetup({ onClose, onImported }) {
  const dialog = useRef();
  const fileInput = useRef();
  const [mode, setMode] = useState('import'); // import | lock
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null); // { name, text }
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { dialog.current.showModal(); }, []);

  const reset = (next) => {
    setMode(next); setFile(null); setNeedsPassword(false); setPassword(''); setConfirm(''); setResult(null); setError(null);
  };

  const importText = async (text, pw) => {
    setBusy(true); setError(null); setResult(null);
    try {
      setResult(await api.post('/api/team-setup', { text, password: pw || undefined }));
      setNeedsPassword(false); setPassword('');
      onImported();
    } catch (err) {
      // A locked file just asks for its password; a wrong password says so.
      const locked = err.details?.needsPassword;
      if (locked) setNeedsPassword(true);
      setError(locked && !pw ? null : err.message);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (f) => {
    if (!f) return;
    const picked = { name: f.name, text: await f.text() };
    setFile(picked); setResult(null); setError(null);
    if (mode === 'import') importText(picked.text);
  };

  const lock = async () => {
    setBusy(true); setError(null);
    try {
      const locked = await api.post('/api/team-setup/lock', { text: file.text, password });
      const url = URL.createObjectURL(new Blob([JSON.stringify(locked, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Team setup (locked).json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setResult({ locked: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const drop = (
    <div
      className={`team-drop ${over ? 'drop-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
    >
      <Icon name="upload" size={22} />
      <strong>{busy ? 'Working…' : file ? file.name : mode === 'import' ? 'Drop your setup file here' : 'Drop the .env file to lock'}</strong>
      <button disabled={busy} onClick={() => fileInput.current.click()}>{file ? 'Choose another…' : 'Choose file…'}</button>
      <input ref={fileInput} type="file" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; pick(f); }} />
    </div>
  );

  return (
    <dialog ref={dialog} className="export-dialog team-dialog" aria-labelledby="team-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <div className="stack">
        <div className="team-hero">
          <span className="team-badge"><Icon name="star" size={22} /></span>
          <div>
            <h2 id="team-title">Welcome to Nico's SUPER SECRET SETUP!!!</h2>
            <p className="muted">
              {mode === 'import'
                ? 'Drop the setup file you were given. The API keys are saved on this computer, locked to your Windows account, and never shown again.'
                : 'Turn a .env file into a password-locked setup file. Send the file one way and tell people the password another way.'}
            </p>
          </div>
        </div>

        {drop}

        {mode === 'import' && needsPassword && !result && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); importText(file.text, password); }}>
            <input className="grow" type="password" autoFocus aria-label="Setup file password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="primary" disabled={busy || !password}>Unlock</button>
          </form>
        )}

        {mode === 'lock' && file && !result && (
          <form className="stack-tight" onSubmit={(e) => { e.preventDefault(); lock(); }}>
            <input type="password" autoFocus aria-label="New password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input type="password" aria-label="Repeat password" placeholder="Repeat password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {confirm && confirm !== password && <span className="warn-text small">The passwords don't match yet.</span>}
            <button className="primary" disabled={busy || password.length < 8 || confirm !== password}>Save locked file</button>
          </form>
        )}

        {result?.services && (
          <div className="saved team-result">
            <Icon name="check" />
            <span>Keys added for {result.services.join(', ')}. You can delete the file now.{result.ignored.length > 0 && ` Skipped: ${result.ignored.join(', ')}.`}</span>
          </div>
        )}
        {result?.locked && (
          <div className="saved team-result">
            <Icon name="check" />
            <span>Locked file saved. Send it to your team, and share the password separately.</span>
          </div>
        )}
        {error && <div className="error" role="alert">{error}</div>}

        <div className="row">
          <button className="link-btn subtle" disabled={busy} onClick={() => reset(mode === 'import' ? 'lock' : 'import')}>
            {mode === 'import' ? 'Make a locked file' : 'Back to import'}
          </button>
          <span className="grow" />
          <button className={result ? 'primary' : ''} disabled={busy} onClick={onClose}>{result ? 'Done' : 'Cancel'}</button>
        </div>
      </div>
    </dialog>
  );
}
