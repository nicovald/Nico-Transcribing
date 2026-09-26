import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

export default function ExportDialog({ jobId, plan, labels, onClose, onSaved }) {
  const dialog = useRef();
  const [selected, setSelected] = useState(() => plan.files.map(f => f.key));
  const [conflict, setConflict] = useState('keep-both');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  const existing = plan.files.filter(f => selected.includes(f.key) && f.exists);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api.post(`/api/jobs/${jobId}/export`, { dir: plan.dir, labels, keys: selected, conflict });
      onSaved(result.written); onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return <dialog ref={dialog} className="export-dialog" aria-labelledby="export-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="stack">
      <div><h2 id="export-title">Export subtitles</h2><p className="muted">Choose the files to save. Your transcript stays editable in the app.</p></div>
      <div className="export-files">{plan.files.map(f => <label key={f.key} className="export-file">
        <input type="checkbox" disabled={busy} checked={selected.includes(f.key)} onChange={e => setSelected(keys => e.target.checked ? [...keys,f.key] : keys.filter(k => k !== f.key))} />
        <span className="grow"><strong>{f.filename}</strong><small title={f.destination}>{f.destination}</small></span>
        <span className={f.exists ? 'warn-text small' : 'muted small'}>{f.exists ? 'Already exists' : f.merged ? 'Merged' : 'Single track'}</span>
      </label>)}</div>
      <label>If a file already exists<select disabled={busy} value={conflict} onChange={e => setConflict(e.target.value)}><option value="keep-both">Keep both — add a number to the new file</option><option value="replace">Replace the existing file</option></select></label>
      {existing.length > 0 && conflict === 'replace' && <div className="banner">{existing.length} existing file{existing.length === 1 ? '' : 's'} will be replaced when you export.</div>}
      {error && <div className="error" role="alert">{error}</div>}
      <div className="row"><span className="grow muted small">{selected.length} of {plan.files.length} files selected</span><button disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !selected.length} onClick={save}>{busy ? 'Saving…' : conflict === 'replace' && existing.length ? 'Replace and export' : 'Export files'}</button></div>
    </div>
  </dialog>;
}
