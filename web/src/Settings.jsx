import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useApp } from './App.jsx';
import { desktop, Icon } from './shared.jsx';
import TermLists from './TermLists.jsx';
import Presets from './Presets.jsx';
import SubtitlePreview from './SubtitlePreview.jsx';
import Updates from './Updates.jsx';
import useUnsaved from './useUnsaved.js';

const editedFields = ({ keys: { github, ...keys }, models, proofread, confidenceThreshold, cue }) => ({ keys, models, proofread, confidenceThreshold, cue });
const sections = [['services','Transcription'], ['proofread','Proofreading'], ['presets','Presets'], ['terms','Term lists'], ['subtitles','Subtitle layout'], ['updates','App updates']];

const EXTRA_KEYS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', url: 'https://console.anthropic.com/settings/keys', notes: 'Used for AI proofreading.' },
  { id: 'typesafe', name: 'TypeSafe (Jev)', url: 'https://docs.typesafe.ai/introduction/quickstart', notes: 'Optional. Double-checks each suggested fix and gives it a confidence score.' },
];

const openLink = (e, url) => {
  if (desktop) {
    e.preventDefault();
    desktop.openExternal(url);
  }
};

// Proofreading model: default, suggested picks, everything the key can use (live from the service), or typed.
function ModelPicker({ proofreader, hasKey, value, onChange }) {
  const [live, setLive] = useState({ models: [], error: null, loading: false });
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    setTyping(false);
    if (!proofreader || !hasKey) return setLive({ models: [], error: null, loading: false });
    setLive((l) => ({ ...l, loading: true }));
    api.get(`/api/proofreaders/${proofreader.id}/models`)
      .then((r) => setLive({ models: r.models, error: r.error || null, loading: false }))
      .catch((err) => setLive({ models: [], error: err.message, loading: false }));
  }, [proofreader?.id, hasKey]);
  if (!proofreader) return null;
  const suggested = proofreader.suggested || [];
  const listed = new Set([proofreader.defaultModel, ...suggested.map((s) => s.id)]);
  const others = live.models.filter((m) => !listed.has(m));
  const known = !value || listed.has(value) || live.models.includes(value);
  const showInput = typing || !known;
  const note = (id) => suggested.find((s) => s.id === id)?.note;
  return (
    <label>
      Model
      {showInput ? (
        <span className="row">
          <input className="grow" autoFocus={typing} value={value} placeholder={proofreader.defaultModel} onChange={(e) => onChange(e.target.value)} aria-label="Model name" />
          <button type="button" className="ghost small-btn" onClick={() => { setTyping(false); onChange(''); }}>Use list</button>
        </span>
      ) : (
        <select value={value} onChange={(e) => (e.target.value === '__other' ? setTyping(true) : onChange(e.target.value))}>
          <option value="">Default · {proofreader.defaultModel}{note(proofreader.defaultModel) ? ` (${note(proofreader.defaultModel)})` : ''}</option>
          {suggested.filter((s) => s.id !== proofreader.defaultModel).map((s) => <option key={s.id} value={s.id}>{s.id} ({s.note})</option>)}
          {others.length > 0 && <optgroup label={`All ${proofreader.name} models`}>{others.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>}
          <option value="__other">Other… (type a model name)</option>
        </select>
      )}
      <span className="hint">{live.loading ? 'Loading models…' : live.error || (hasKey ? 'The default is plenty for catching misheard words.' : `Add a ${proofreader.name} key to see every model.`)}</span>
    </label>
  );
}

export default function Settings() {
  const { providers, settings, reloadSettings } = useApp();
  const [form, setForm] = useState(() => structuredClone(settings));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('services');
  const [busy, setBusy] = useState(false);
  const [baseline, setBaseline] = useState(() => JSON.stringify(editedFields(settings)));
  const dirty = JSON.stringify(editedFields(form)) !== baseline;
  useUnsaved(dirty || busy);

  const set = (path, value) => {
    setSaved(false);
    setForm((f) => {
      const next = structuredClone(f);
      const keys = path.split('.');
      let obj = next;
      for (const k of keys.slice(0, -1)) obj = obj[k] ??= {};
      obj[keys.at(-1)] = value;
      return next;
    });
  };
  const text = (path) => (e) => set(path, e.target.value);
  const num = (path) => (e) => set(path, Number(e.target.value));
  const check = (path) => (e) => set(path, e.target.checked);

  const save = async (e) => {
    e?.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      // Send only what this page edits so remembered transcribe options aren't overwritten.
      const { github, ...keys } = form.keys;
      const { models, proofread, confidenceThreshold, cue } = form;
      const next = await api.put('/api/settings', { keys, models, proofread, confidenceThreshold, cue });
      setForm(structuredClone(next));
      setBaseline(JSON.stringify(editedFields(next)));
      await reloadSettings();
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && location.hash.startsWith('#/settings')) { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form, busy, dirty]);

  const keyRow = ({ id, name, url, notes, model, modelPath, modelPlaceholder }) => (
    <details key={id + (modelPath || '')} className="service-card" open={Boolean(settings.keys[id]) || id === 'grok'}>
      <summary><strong>{name}</strong><span className={settings.keys[id] ? 'ok small' : 'muted small'}>{settings.keys[id] ? 'Key saved' : 'Not configured'}</span></summary>
      <div className="key-row">
      <label>
        <span className="row">
          <strong className="grow">{name}</strong>
          <a href={url} target="_blank" rel="noreferrer" className="small" onClick={(e) => openLink(e, url)}>Get a key <Icon name="external" size={12} /></a>
        </span>
        <input aria-label={`${name} API key`} type="password" autoComplete="off" value={form.keys[id] || ''} onChange={text(`keys.${id}`)} onFocus={(e) => e.target.select()} placeholder="Paste API key" />
      </label>
      {modelPath ? (
        <label>
          Model override (optional)
          <input value={model || ''} onChange={text(modelPath)} placeholder={modelPlaceholder || 'provider default'} />
        </label>
      ) : (
        <span />
      )}
      {notes && <span className="hint">{notes}</span>}
      </div>
    </details>
  );

  return (
    <div className="stack">
      <div className="page-head"><h1>Settings</h1><p className="muted">Set up the services and defaults your editing workflow needs.</p></div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">{sections.filter(([id]) => desktop || id !== 'updates').map(([id,name]) => <button type="button" key={id} className={tab === id ? 'selected' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{name}</button>)}</nav>
        <div className="stack settings-content">
      <div hidden={tab !== 'updates'}>{desktop && <Updates />}</div>
      <div hidden={tab !== 'presets'}><Presets /></div>
      <div hidden={tab !== 'terms'}><TermLists /></div>
      <form className="stack" onSubmit={save}>
      <fieldset disabled={busy} className="settings-fields">

      <section className="card" hidden={tab !== 'services'}>
        <h2>Transcription services</h2>
        <p className="muted small">Choose one service to get started. {desktop ? 'API keys are protected by your Windows account.' : 'Keys are stored on this computer.'} Audio is sent to the service you select. A saved key has not yet been tested with the service.</p>
        {providers.transcribers.map((p) =>
          keyRow({ id: p.id, name: p.name, url: p.keyUrl, notes: p.notes, model: form.models?.[p.id], modelPath: `models.${p.id}`, modelPlaceholder: p.model }),
        )}
      </section>

      <section className="card" hidden={tab !== 'proofread'}>
        <h2>AI proofreading</h2>
        <p className="muted small">After each transcript, an AI reads it with your project description and term lists and suggests fixes for misheard words.</p>
        <div className="grid-2">
          <label>
            Proofread with
            <select value={form.proofread.provider} onChange={text('proofread.provider')}>
              {providers.proofreaders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {form.keys[p.keyName] ? '' : ' (no key)'}
                </option>
              ))}
            </select>
            <span className="hint">If this one has no key, the first one that does is used.</span>
          </label>
          <ModelPicker
            proofreader={providers.proofreaders.find((p) => p.id === form.proofread.provider)}
            hasKey={Boolean(settings.keys[providers.proofreaders.find((p) => p.id === form.proofread.provider)?.keyName])}
            value={form.proofread.models?.[form.proofread.provider] || ''}
            onChange={(v) => set(`proofread.models.${form.proofread.provider}`, v)}
          />
        </div>
        <div className="checks">
          <label>
            <input type="checkbox" checked={form.proofread.auto} onChange={check('proofread.auto')} /> Proofread automatically when a transcript finishes
          </label>
        </div>
        {EXTRA_KEYS.map((k) => keyRow(k))}
        <p className="hint">OpenAI and xAI proofreading use the same keys as the transcription services above.</p>
      </section>

      <section className="card" hidden={tab !== 'subtitles'}>
        <h2>Subtitle lines</h2>
        <p className="muted small">How words are grouped into SRT lines. Use "Re-split lines" on a transcript to apply changes to one you already made.</p>
        <div className="grid-3">
          <label>
            Max characters per line
            <input type="number" min="10" max="120" value={form.cue.maxLineChars} onChange={num('cue.maxLineChars')} />
          </label>
          <label>
            Lines per subtitle
            <select value={form.cue.maxLines} onChange={num('cue.maxLines')}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
          <label>
            Max seconds per subtitle
            <input type="number" min="1" max="20" step="0.5" value={form.cue.maxDuration} onChange={num('cue.maxDuration')} />
          </label>
          <label>
            New subtitle after a pause of (s)
            <input type="number" min="0.2" max="5" step="0.1" value={form.cue.pauseSplit} onChange={num('cue.pauseSplit')} />
          </label>
          <label>
            Min seconds on screen
            <input type="number" min="0" max="5" step="0.1" value={form.cue.minDuration} onChange={num('cue.minDuration')} />
          </label>
        </div>
        <label>
          Underline words below {Math.round(form.confidenceThreshold * 100)}% confidence (Deepgram, AssemblyAI, ElevenLabs)
          <input type="range" min="0.3" max="0.95" step="0.05" value={form.confidenceThreshold} onChange={num('confidenceThreshold')} />
        </label>
        <div className="preview-head"><h3>Live preview</h3><span className="muted small">A sample clip, split with the settings above. Changes show instantly; save to use them.</span></div>
        <SubtitlePreview cue={form.cue} threshold={form.confidenceThreshold} />
      </section>

      </fieldset>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="save-bar" hidden={!['services','proofread','subtitles'].includes(tab) && !dirty}>
        <button className="primary" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save settings'}</button>
        <span className={dirty ? 'warn-text small' : 'muted small'}>{dirty ? 'Unsaved changes · Ctrl+S to save' : saved ? 'Settings saved' : 'All changes saved'}</span>
      </div>
      </form>
        </div>
      </div>
    </div>
  );
}
