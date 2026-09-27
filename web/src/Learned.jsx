import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './shared.jsx';
import useUnsaved from './useUnsaved.js';

const TIERS = { usual: 'Usually this', unsure: 'Not sure' };
const PINS = [
  ['', 'Automatic'],
  ['usual', 'Always "Usually this"'],
  ['unsure', 'Always "Not sure"'],
  ['never', 'Never flag'],
];
const joinList = (list) => (list || []).join(', ');
const toDraft = (people) => people.map((p) => ({ ...p, aka: joinList(p.aka), heardAs: joinList(p.heardAs) }));

// What the app has learned: people who are usually in the videos, and fixes editors keep making.
// Stays mounted (like Settings) so a half-typed name is never lost; refreshes when opened.
export default function Learned({ active }) {
  const [fixes, setFixes] = useState(null);
  const [people, setPeople] = useState(null);
  const [saved, setSaved] = useState(null);
  const [status, setStatus] = useState(null); // 'saving' | 'saved' | error text
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [newFix, setNewFix] = useState({ from: '', to: '' });
  const timer = useRef();
  const fileInput = useRef();
  useUnsaved(people && JSON.stringify(people) !== saved);

  const load = async (withPeople) => {
    try {
      const m = await api.get('/api/memory');
      setFixes(m.fixes);
      if (withPeople) {
        const draft = toDraft(m.people);
        setPeople(draft);
        setSaved(JSON.stringify(draft));
      }
    } catch (err) {
      setError(err.message);
    }
  };
  // Fixes change while you review, so reload them whenever the page opens.
  useEffect(() => { if (active) load(people == null); }, [active]);

  // People save themselves shortly after typing stops.
  useEffect(() => {
    if (!people || JSON.stringify(people) === saved) return;
    clearTimeout(timer.current);
    setStatus('saving');
    timer.current = setTimeout(async () => {
      if (people.some((p) => !p.name.trim())) return setStatus('Every person needs a name.');
      try {
        await api.put('/api/memory/people', { people });
        setSaved(JSON.stringify(people));
        setStatus('saved');
      } catch (err) {
        setStatus(err.message);
      }
    }, 700);
    return () => clearTimeout(timer.current);
  }, [people]);

  const editPerson = (id, patch) => setPeople((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const addPerson = () => setPeople((list) => [...list, { id: crypto.randomUUID(), name: '', aka: '', heardAs: '' }]);
  const removePerson = (p) => {
    if (!p.name || window.confirm(`Remove ${p.name} from the people list?`)) setPeople((list) => list.filter((x) => x.id !== p.id));
  };

  const run = async (fn) => {
    setError(null);
    try { await fn(); } catch (err) { setError(err.message); }
  };
  const updateFix = (f, patch) => run(async () => setFixes((await api.patch(`/api/memory/fixes/${f.id}`, patch)).fixes));
  const deleteFix = (f) => run(async () => {
    if (!window.confirm(`Forget "${f.from}" → "${f.to}"?`)) return;
    setFixes((await api.del(`/api/memory/fixes/${f.id}`)).fixes);
  });
  const addFix = (e) => {
    e.preventDefault();
    run(async () => {
      setFixes((await api.post('/api/memory/fixes', newFix)).fixes);
      setNewFix({ from: '', to: '' });
    });
  };

  const importFile = async (file) => {
    setMessage(null);
    await run(async () => {
      let data;
      try { data = JSON.parse(await file.text()); } catch { throw new Error('That file is not a memory file exported from Nico\'s Transcriber.'); }
      const r = await api.post('/api/memory/import', data);
      setFixes(r.memory.fixes);
      const draft = toDraft(r.memory.people);
      setPeople(draft);
      setSaved(JSON.stringify(draft));
      setMessage(`Imported ${r.people} new ${r.people === 1 ? 'person' : 'people'} and ${r.fixes} new ${r.fixes === 1 ? 'fix' : 'fixes'}. Existing ones were merged.`);
    });
  };

  const counts = { all: fixes?.length || 0, usual: 0, unsure: 0, off: 0 };
  for (const f of fixes || []) counts[f.tier || 'off']++;
  const q = query.trim().toLowerCase();
  const shown = (fixes || [])
    .filter((f) => filter === 'all' || (f.tier || 'off') === filter)
    .filter((f) => !q || `${f.from} ${f.to}`.toLowerCase().includes(q))
    .sort((a, b) => b.fixed - a.fixed || a.from.localeCompare(b.from));

  return (
    <div className="stack learned">
      <div className="page-head row wrap">
        <div className="grow">
          <h1>Learned fixes</h1>
          <p className="muted">Every Fix, Ignore and retyped word teaches the app. Fixes you keep making become <strong className="tier-word usual">Usually this</strong>; newer or mixed ones stay <strong className="tier-word unsure">Not sure</strong>.</p>
        </div>
        <button onClick={() => fileInput.current.click()}><Icon name="upload" /> Import file</button>
        <a className="button" href="/api/memory/export" download><Icon name="download" /> Export for the team</a>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); }} />
      </div>
      {message && <div className="saved"><Icon name="check" /> {message}</div>}
      {error && <div className="error">{error}</div>}

      <section className="card">
        <div className="row wrap">
          <span className="section-tile tile-people"><Icon name="users" /></span>
          <h2 className="grow">People in the videos</h2>
          <span className="muted small">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}</span>
          <button onClick={addPerson}><Icon name="plus" /> Add person</button>
        </div>
        {status && !['saving', 'saved'].includes(status) && <div className="error">{status}</div>}
        <p className="muted small">Names are sent to the transcriber so it spells them right, and the AI proofread knows who is who. Words that sound like a name get flagged as <em>Not sure</em>, never changed on their own.</p>
        {!people ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="people">
            <div className="people-head"><span>Name</span><span>Also called</span><span>Often misheard as</span><span /></div>
            {people.map((p) => (
              <div key={p.id} className="person">
                <input aria-label="Name" className="person-name" value={p.name} placeholder="Name as it should be spelled" onChange={(e) => editPerson(p.id, { name: e.target.value })} />
                <input aria-label={`Other names for ${p.name}`} value={p.aka} placeholder="Real name, nicknames" onChange={(e) => editPerson(p.id, { aka: e.target.value })} />
                <input aria-label={`Mishearings of ${p.name}`} value={p.heardAs} placeholder="Misspellings, comma separated" onChange={(e) => editPerson(p.id, { heardAs: e.target.value })} />
                <button className="icon-btn" title="Remove person" onClick={() => removePerson(p)}><Icon name="trash" /></button>
              </div>
            ))}
            {!people.length && <p className="muted small">Nobody yet. Add the people who are usually in your videos.</p>}
          </div>
        )}
      </section>

      <section className="card">
        <div className="row wrap">
          <span className="section-tile tile-fixes"><Icon name="star" /></span>
          <h2 className="grow">Fixes</h2>
          <input className="fix-search" aria-label="Search fixes" placeholder="Search fixes…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="segmented">
          {[['all', 'All'], ['usual', 'Usually this'], ['unsure', 'Not sure'], ['off', 'Not flagged']].map(([id, label]) => (
            <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{label} <span className="count">{counts[id]}</span></button>
          ))}
        </div>
        {fixes && !fixes.length ? (
          <p className="empty-note">Nothing learned yet. When you click Fix or Ignore on a suggestion, or retype a misheard word, it shows up here.</p>
        ) : (
          <ul className="fixes">
            {shown.map((f) => (
              <li key={f.id} className="fix">
                <span className="sug-from">{f.from}</span>
                <span className="sug-arrow">→</span>
                <strong className="fix-to">{f.to}</strong>
                {f.tier ? <span className={`tier ${f.tier}`}>{TIERS[f.tier]}</span> : <span className="tier off">Not flagged</span>}
                <span className="grow muted small">Fixed {f.fixed} · Ignored {f.ignored}</span>
                <select aria-label={`How to flag "${f.from}"`} value={f.pin || ''} onChange={(e) => updateFix(f, { pin: e.target.value || null })}>
                  {PINS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
                <button className="icon-btn" title="Forget this fix" onClick={() => deleteFix(f)}><Icon name="trash" /></button>
              </li>
            ))}
            {fixes && fixes.length > 0 && !shown.length && <p className="muted small">No fixes match.</p>}
          </ul>
        )}
        <form className="add-fix" onSubmit={addFix}>
          <input aria-label="Misheard as" placeholder="Misheard as (couples stone)" value={newFix.from} onChange={(e) => setNewFix({ ...newFix, from: e.target.value })} />
          <span className="sug-arrow">→</span>
          <input aria-label="Should be" placeholder="Should be (Cobblestone)" value={newFix.to} onChange={(e) => setNewFix({ ...newFix, to: e.target.value })} />
          <button disabled={!newFix.from.trim() || !newFix.to.trim()}><Icon name="plus" /> Add fix</button>
        </form>
        <p className="muted small">Fixes you add by hand start as "Usually this". "Automatic" moves a fix to Usually this once it has been fixed 3+ times and almost never ignored.</p>
      </section>
    </div>
  );
}
