import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useApp } from './App.jsx';
import { Icon, LANGUAGES } from './shared.jsx';

const blank = (settings) => ({
  id: crypto.randomUUID(),
  name: 'New preset',
  context: '',
  provider: settings.lastOptions.provider,
  language: settings.lastOptions.language ?? 'en',
  termListIds: [],
  keyterms: '',
  voiceCleanup: true,
  diarize: false,
  fillerWords: false,
  tracks: [],
});

// Presets save themselves, separate from the Settings form.
export default function Presets() {
  const { settings, providers, reloadSettings } = useApp();
  const [presets, setPresets] = useState(settings.presets);
  const [status, setStatus] = useState(null);
  const timer = useRef();
  const first = useRef(true);

  // Presets can also be created from a project ("Save as new preset"); pick those up.
  const lastSaved = useRef(settings.presets);
  useEffect(() => {
    if (settings.presets !== lastSaved.current && JSON.stringify(settings.presets) !== JSON.stringify(presets)) {
      lastSaved.current = settings.presets;
      first.current = true;
      setPresets(settings.presets);
    }
  }, [settings.presets]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clearTimeout(timer.current);
    setStatus('saving');
    timer.current = setTimeout(async () => {
      try {
        await api.put('/api/settings', { presets });
        await reloadSettings();
        setStatus('saved');
      } catch (err) {
        setStatus(err.message);
      }
    }, 600);
    return () => clearTimeout(timer.current);
  }, [presets]);

  const update = (id, patch) => setPresets((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const remove = (p) => {
    if (window.confirm(`Delete the preset "${p.name}"? Projects using it keep their settings.`)) setPresets((ps) => ps.filter((x) => x.id !== p.id));
  };

  return (
    <section className="card">
      <div className="row wrap">
        <h2 className="grow">Presets</h2>
        <span className="muted small">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : ''}</span>
        <button type="button" onClick={() => setPresets((ps) => [...ps, blank(settings)])}><Icon name="plus" /> New preset</button>
      </div>
      {status && status !== 'saving' && status !== 'saved' && <div className="error">{status}</div>}
      <p className="muted small">
        One preset per series or recording setup, e.g. "Minecraft vanilla" or "ATM10 To The Sky". Pick one when you drop videos and the project comes pre-filled.
        Easiest way to make one: set up a project, then click <b>Save as new preset</b> under Transcribe.
      </p>
      {!presets.length && <p className="muted small">No presets yet.</p>}
      {presets.map((p) => (
        <PresetCard key={p.id} preset={p} settings={settings} providers={providers.transcribers} onChange={(patch) => update(p.id, patch)} onDelete={() => remove(p)} />
      ))}
    </section>
  );
}

function PresetCard({ preset: p, settings, providers, onChange, onDelete }) {
  const [open, setOpen] = useState(false);
  const lists = settings.termLists.filter((l) => p.termListIds?.includes(l.id));
  const toggleList = (id) => onChange({ termListIds: p.termListIds?.includes(id) ? p.termListIds.filter((x) => x !== id) : [...(p.termListIds || []), id] });
  const setTrack = (i, patch) => onChange({ tracks: p.tracks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

  return (
    <div className="preset-card">
      <div className="row">
        <input className="grow list-name" value={p.name} onChange={(e) => onChange({ name: e.target.value })} />
        <button type="button" onClick={() => setOpen(!open)}>{open ? 'Done' : 'Edit'}</button>
        <button type="button" className="ghost small-btn" onClick={onDelete}>Delete</button>
      </div>
      {!open && (
        <div className="muted small">
          {providers.find((x) => x.id === p.provider)?.name} · {LANGUAGES.find(([c]) => c === p.language)?.[1] ?? 'Auto'}
          {lists.length > 0 && ` · ${lists.map((l) => l.name).join(' + ')}`}
          {p.tracks?.length > 0 && ` · tracks: ${p.tracks.map((t) => (t.on ? t.name : `(${t.name})`)).join(', ')}`}
        </div>
      )}
      {open && (
        <>
          <label>
            What's in these videos?
            <input value={p.context} onChange={(e) => onChange({ context: e.target.value })} placeholder="e.g. Modded Minecraft skyblock, ATM10 To The Sky, players Sundee and Crainer" />
          </label>
          <div className="grid-2">
            <label>
              Provider
              <select value={p.provider} onChange={(e) => onChange({ provider: e.target.value })}>
                {providers.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </label>
            <label>
              Language
              <select value={p.language} onChange={(e) => onChange({ language: e.target.value })}>
                {LANGUAGES.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <div className="label-like">Term lists</div>
            <div className="chips">
              {settings.termLists.map((l) => (
                <button type="button" key={l.id} className={`chip-toggle ${p.termListIds?.includes(l.id) ? 'on' : ''}`} onClick={() => toggleList(l.id)}>
                  {p.termListIds?.includes(l.id) ? '✓ ' : ''}
                  {l.name}
                </button>
              ))}
              {!settings.termLists.length && <span className="muted small">Make term lists below first.</span>}
            </div>
          </div>
          <label>
            Extra terms <span className="hint-inline">player and channel names, comma separated</span>
            <input value={p.keyterms} onChange={(e) => onChange({ keyterms: e.target.value })} placeholder="Sundee, Crainer, Ian" />
          </label>
          <div className="checks">
            <label><input type="checkbox" checked={p.voiceCleanup} onChange={(e) => onChange({ voiceCleanup: e.target.checked })} /> Voice cleanup</label>
            <label><input type="checkbox" checked={p.diarize} onChange={(e) => onChange({ diarize: e.target.checked })} /> Split by speaker</label>
            <label><input type="checkbox" checked={p.fillerWords} onChange={(e) => onChange({ fillerWords: e.target.checked })} /> Keep "um"/"uh"</label>
          </div>
          <div>
            <div className="label-like">
              Track layout <span className="hint-inline">names for audio tracks 1, 2, 3… Untick tracks to skip, like game audio</span>
            </div>
            <div className="stack-tight">
              {(p.tracks || []).map((t, i) => (
                <div key={i} className="layout-row">
                  <input type="checkbox" checked={t.on} onChange={(e) => setTrack(i, { on: e.target.checked })} title="Transcribe this track" />
                  <input value={t.name} onChange={(e) => setTrack(i, { name: e.target.value })} placeholder={`Track ${i + 1}`} />
                  <button type="button" className="icon-btn" title="Remove" onClick={() => onChange({ tracks: p.tracks.filter((_, j) => j !== i) })}><Icon name="x" /></button>
                </div>
              ))}
              <button type="button" className="small-btn" style={{ alignSelf: 'flex-start' }} onClick={() => onChange({ tracks: [...(p.tracks || []), { name: `Track ${(p.tracks?.length || 0) + 1}`, on: true }] })}>
                <Icon name="plus" /> Add track
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
