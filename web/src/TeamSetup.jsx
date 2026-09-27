import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './shared.jsx';

// Hidden on purpose (Ctrl+Shift+T): a studio gives its editors a .env file with the keys it pays for.
export default function TeamSetup({ onClose, onImported }) {
  const dialog = useRef();
  const fileInput = useRef();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { dialog.current.showModal(); }, []);

  const load = async (file) => {
    if (!file) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api.post('/api/team-setup', { text: await file.text() });
      setResult(r);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="export-dialog team-dialog" aria-labelledby="team-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <div className="stack">
        <div>
          <h2 id="team-title">Team setup</h2>
          <p className="muted">Drop the setup file you were given. Its API keys are saved on this computer, protected by Windows, and never shown again.</p>
        </div>
        <div
          className={`team-drop ${over ? 'drop-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}
        >
          <Icon name="upload" size={22} />
          <strong>{busy ? 'Importing…' : 'Drop the .env file here'}</strong>
          <button disabled={busy} onClick={() => fileInput.current.click()}>Choose file…</button>
          <input ref={fileInput} type="file" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; load(f); }} />
        </div>
        {result && (
          <div className="saved team-result">
            <Icon name="check" />
            <span>Keys added for {result.services.join(', ')}. You can delete the file now.{result.ignored.length > 0 && ` Skipped: ${result.ignored.join(', ')}.`}</span>
          </div>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row">
          <span className="grow" />
          <button className={result ? 'primary' : ''} disabled={busy} onClick={onClose}>{result ? 'Done' : 'Cancel'}</button>
        </div>
      </div>
    </dialog>
  );
}
