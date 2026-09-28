import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { desktop, Icon } from './shared.jsx';
import Updates from './Updates.jsx';

// Hidden on purpose (Ctrl+Shift+T). A studio gives its editors a .env file with the API keys it pays
// for, and optionally a settings file with its suggested setup. The first open plays a joke intro.
const INTRO = [
  'Initializing Nico\'s SUPER SECRET SETUP...',
  'Scanning fingerprint... that\'s a mouse. Close enough.',
  'Checking you are not Crainer... probably not.',
  'Asking SSundee for permission... he said "sure, whatever".',
  'Teaching the AI to spell Lookum... still working on it.',
  'Downloading more RAM... 100%',
  'Hiding Nico\'s credit card... done.',
];
const SEEN_KEY = 'secret-setup-intro-seen';
const introSeen = () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable */ } };

export default function TeamSetup({ onClose, onImported }) {
  const dialog = useRef();
  const fileInput = useRef();
  const [intro, setIntro] = useState(() => !introSeen());
  const [shown, setShown] = useState(0);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [party, setParty] = useState(0);
  useEffect(() => { dialog.current.showModal(); }, []);

  // Intro lines appear one at a time, then ACCESS GRANTED.
  useEffect(() => {
    if (!intro || shown > INTRO.length) return;
    const timer = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 250 : 650);
    return () => clearTimeout(timer);
  }, [intro, shown]);
  const finishIntro = () => { markSeen(); setIntro(false); };
  const replayIntro = () => { setShown(0); setIntro(true); };

  const load = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post('/api/team-setup', { text: await file.text() });
      setResults((list) => [...list, r.services
        ? `Keys added for ${r.services.join(', ')}.${r.ignored.length ? ` Skipped: ${r.ignored.join(', ')}.` : ''}`
        : `Settings imported: ${r.imported.join(', ')}.`]);
      setParty((n) => n + 1);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="export-dialog team-dialog" aria-labelledby="team-title" onCancel={(e) => { e.preventDefault(); if (!busy && !updating) onClose(); }}>
      {intro ? (
        <div className="stack">
          <div className="terminal" role="status" aria-live="polite">
            {INTRO.slice(0, shown).map((line, i) => <div key={i}><span className="prompt">&gt;</span> {line}</div>)}
            {shown > INTRO.length && <div className="granted">ACCESS GRANTED</div>}
            {shown <= INTRO.length && <span className="cursor" />}
          </div>
          <div className="row">
            <span className="grow" />
            {shown > INTRO.length ? <button className="primary" autoFocus onClick={finishIntro}>Let me in</button> : <button className="ghost" onClick={finishIntro}>Skip</button>}
          </div>
        </div>
      ) : (
        <div className="stack">
          {party > 0 && <Confetti key={party} />}
          <div className="team-hero">
            <span className="team-badge"><Icon name="star" size={22} /></span>
            <div>
              <h2 id="team-title">Welcome to Nico's SUPER SECRET SETUP!!!</h2>
              <p className="muted">Drop the <strong>.env</strong> file with your API keys, and the <strong>settings file</strong> if you were given one. Keys are saved on this computer, locked to your Windows account, and never shown again.</p>
            </div>
          </div>
          <div
            className={`team-drop ${over ? 'drop-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); [...e.dataTransfer.files].reduce((p, f) => p.then(() => load(f)), Promise.resolve()); }}
          >
            <Icon name="upload" size={22} />
            <strong>{busy ? 'Importing…' : 'Drop files here'}</strong>
            <button disabled={busy} onClick={() => fileInput.current.click()}>Choose files…</button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; files.reduce((p, f) => p.then(() => load(f)), Promise.resolve()); }} />
          </div>
          {results.length > 0 && (
            <div className="saved team-result">
              <Icon name="check" />
              <span>{results.join(' ')} You're in. Welcome to the team, legend. You can delete the files now.</span>
            </div>
          )}
          {error && <div className="error" role="alert">{error}</div>}
          {desktop && <details className="private-updates">
            <summary>Private repository updates</summary>
            <Updates privateAccess onBusyChange={setUpdating} />
          </details>}
          <div className="row wrap">
            <a className="button ghost-link" href="/api/team-setup/settings-export" download title="Subtitle layout, proofreading, term lists, presets, learned fixes and people. Never API keys.">
              <Icon name="download" /> Export my settings
            </a>
            <button className="link-btn subtle" onClick={replayIntro}>Replay intro</button>
            <span className="grow" />
            <button className={results.length ? 'primary' : ''} disabled={busy || updating} onClick={onClose}>{results.length ? 'Done' : 'Close'}</button>
          </div>
        </div>
      )}
    </dialog>
  );
}

// A quick burst of confetti in the app's colors.
const COLORS = ['#126ce0', '#ffb020', '#7b61ff', '#ff7a45', '#1fbf7a', '#ff5fa2', '#2bb3ff'];
function Confetti() {
  const pieces = useRef(Array.from({ length: 48 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.3,
    duration: 1.2 + Math.random() * 0.9,
    drift: (Math.random() - 0.5) * 160,
    spin: (Math.random() - 0.5) * 900,
    color: COLORS[i % COLORS.length],
    round: i % 3 === 0,
  }))).current;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className={p.round ? 'round' : ''}
          style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, '--drift': `${p.drift}px`, '--spin': `${p.spin}deg` }}
        />
      ))}
    </div>
  );
}
