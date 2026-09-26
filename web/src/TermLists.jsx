import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useApp } from './App.jsx';

const count = (text, sep) => String(text || '').split(sep).filter((t) => t.trim()).length;
const priorityCount = (l) => count(l.terms, /[\n,]/);
const glossaryCount = (l) => count(l.glossary, /\n/);

// Term lists save themselves (they can be thousands of lines), separate from the Settings form.
export default function TermLists() {
  const { settings, reloadSettings } = useApp();
  const [lists, setLists] = useState(settings.termLists);
  const [status, setStatus] = useState(null); // 'saving' | 'saved' | error text
  const timer = useRef();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clearTimeout(timer.current);
    setStatus('saving');
    timer.current = setTimeout(async () => {
      try {
        await api.put('/api/settings', { termLists: lists });
        await reloadSettings();
        setStatus('saved');
      } catch (err) {
        setStatus(err.message);
      }
    }, 700);
    return () => clearTimeout(timer.current);
  }, [lists]);

  const add = (list) => setLists((ls) => [...ls, { id: crypto.randomUUID(), name: 'New list', terms: '', glossary: '', ...list }]);
  const update = (id, patch) => setLists((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const remove = (id, name) => {
    if (window.confirm(`Delete the term list "${name}"?`)) setLists((ls) => ls.filter((l) => l.id !== id));
  };

  const [loadingMc, setLoadingMc] = useState(false);
  const addMinecraft = async () => {
    setLoadingMc(true);
    setStatus(null);
    try {
      const { version, terms } = await api.get('/api/presets/minecraft');
      add({
        name: `Minecraft (vanilla ${version})`,
        // A starter set of words that are often misheard; edit freely.
        terms: 'Cobblestone, Deepslate, Netherite, Redstone, Enderman, Ender Pearl, Elytra, Creeper, Piglin, Warden, Nether, Blaze Rod, Shulker Box, Totem of Undying, Villager, Obsidian, Diamond Pickaxe, End Crystal, Ender Dragon, Wither',
        glossary: terms.join('\n'),
      });
    } catch (err) {
      setStatus(err.message);
    } finally {
      setLoadingMc(false);
    }
  };

  return (
    <section className="card">
      <div className="row wrap">
        <h2 className="grow">Term lists</h2>
        <span className="muted small">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : ''}</span>
        <button type="button" onClick={addMinecraft} disabled={loadingMc}>{loadingMc ? 'Downloading…' : '＋ All vanilla Minecraft names'}</button>
        <button type="button" onClick={() => add({})}>＋ New list</button>
      </div>
      {status && status !== 'saving' && status !== 'saved' && <div className="error">{status}</div>}
      <p className="muted small">
        One list per game or modpack. Tick lists when you transcribe. <strong>Priority terms</strong> (up to ~100) are sent to the transcriber so it spells them right.{' '}
        <strong>All terms</strong> can be thousands of names (every item, mob, mod…). They're used afterwards to catch sound-alike mistakes and by the AI proofread.
      </p>
      {!lists.length && <p className="muted small">No lists yet.</p>}
      {lists.map((l) => (
        <div key={l.id} className="term-list">
          <div className="row">
            <input className="grow list-name" value={l.name} onChange={(e) => update(l.id, { name: e.target.value })} />
            <button type="button" className="ghost small-btn" onClick={() => remove(l.id, l.name)}>Delete</button>
          </div>
          <label>
            <span>
              Priority terms <span className="hint-inline">sent to the transcriber · {priorityCount(l)} {priorityCount(l) > 100 && '(only the first 100 are used by Grok)'}</span>
            </span>
            <TermBox value={l.terms} rows={2} separator=", " placeholder="Most important names, comma separated: Cobblestone, Netherite, Fluix Crystal…" onChange={(terms) => update(l.id, { terms })} />
          </label>
          <label>
            <span>
              All terms <span className="hint-inline">one per line · {glossaryCount(l).toLocaleString()} names · drop a .txt/.csv/.json file here</span>
            </span>
            <TermBox value={l.glossary || ''} rows={5} separator={'\n'} placeholder={'Paste or drop the full list here, one per line'} onChange={(glossary) => update(l.id, { glossary })} />
          </label>
        </div>
      ))}
    </section>
  );
}

// Textarea that also accepts dropped list files (txt/csv/json), merging them in.
function TermBox({ value, onChange, separator, rows, placeholder }) {
  const [over, setOver] = useState(false);

  const onDrop = async (e) => {
    e.preventDefault();
    setOver(false);
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    const texts = await Promise.all(files.map((f) => f.text()));
    const { terms } = await api.post('/api/terms/parse', { text: [value, ...texts].join('\n') });
    onChange(terms.join(separator));
  };

  return (
    <textarea
      className={over ? 'drop-over' : ''}
      rows={rows}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    />
  );
}
