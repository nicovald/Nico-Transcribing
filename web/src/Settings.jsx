import { useState } from 'react';
import { api } from './api.js';
import { useApp } from './App.jsx';
import { desktop } from './shared.jsx';
import TermLists from './TermLists.jsx';
import Updates from './Updates.jsx';

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

export default function Settings() {
  const { providers, settings, reloadSettings } = useApp();
  const [form, setForm] = useState(() => structuredClone(settings));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

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
    setError(null);
    try {
      // Send only what this page edits so remembered transcribe options aren't overwritten.
      const { github, ...keys } = form.keys;
      const { models, proofread, confidenceThreshold, cue } = form;
      const next = await api.put('/api/settings', { keys, models, proofread, confidenceThreshold, cue });
      setForm(structuredClone(next));
      await reloadSettings();
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const keyRow = ({ id, name, url, notes, model, modelPath, modelPlaceholder }) => (
    <div key={id + (modelPath || '')} className="key-row">
      <label>
        <span className="row">
          <strong className="grow">{name}</strong>
          <a href={url} target="_blank" rel="noreferrer" className="small" onClick={(e) => openLink(e, url)}>Get a key ↗</a>
        </span>
        <input type="password" autoComplete="off" value={form.keys[id] || ''} onChange={text(`keys.${id}`)} onFocus={(e) => e.target.select()} placeholder="Paste API key" />
      </label>
      {modelPath ? (
        <label>
          Model
          <input value={model || ''} onChange={text(modelPath)} placeholder={modelPlaceholder || 'provider default'} />
        </label>
      ) : (
        <span />
      )}
      {notes && <span className="hint">{notes}</span>}
    </div>
  );

  return (
    <form className="stack" onSubmit={save}>
      {desktop && <Updates />}

      <section className="card">
        <h2>Transcription services</h2>
        <p className="muted small">Keys are stored only on this computer. You only need keys for the services you use.</p>
        {providers.transcribers.map((p) =>
          keyRow({ id: p.id, name: p.name, url: p.keyUrl, notes: p.notes, model: form.models?.[p.id], modelPath: `models.${p.id}`, modelPlaceholder: p.model }),
        )}
      </section>

      <section className="card">
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
          <label>
            Model
            <input
              value={form.proofread.models?.[form.proofread.provider] || ''}
              onChange={text(`proofread.models.${form.proofread.provider}`)}
              placeholder={providers.proofreaders.find((p) => p.id === form.proofread.provider)?.defaultModel}
            />
          </label>
        </div>
        <div className="checks">
          <label>
            <input type="checkbox" checked={form.proofread.auto} onChange={check('proofread.auto')} /> Proofread automatically when a transcript finishes
          </label>
        </div>
        {EXTRA_KEYS.map((k) => keyRow(k))}
        <p className="hint">OpenAI and xAI proofreading use the same keys as the transcription services above.</p>
      </section>

      <TermLists />

      <section className="card">
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
      </section>

      {error && <div className="error">{error}</div>}
      <div className="save-bar">
        <button className="primary big-btn">Save settings</button>
        {saved && <span className="ok">Saved ✓</span>}
      </div>
    </form>
  );
}
