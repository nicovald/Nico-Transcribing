import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useApp } from './App.jsx';
import { Icon } from './shared.jsx';
import useUnsaved from './useUnsaved.js';
import AiTermListDialog from './AiTermListDialog.jsx';
import { parseTermListAnswer } from '../../server/aiTermList.js';

const count = (text, sep) => String(text || '').split(sep).filter((t) => t.trim()).length;
const priorityCount = (l) => count(l.terms, /[\n,]/);
const glossaryCount = (l) => count(l.glossary, /\n/);
const FILE_KIND = 'grok-transcriber-term-list';

// Which lists are expanded is a per-computer convenience; lists start collapsed because they can be huge.
const OPEN_KEY = 'term-lists-open';
const readOpen = () => { try { return JSON.parse(localStorage.getItem(OPEN_KEY)) || []; } catch { return []; } };
const writeOpen = (ids) => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ } };

// Saves one list as a file teammates can import.
function exportList(l) {
  const data = { kind: FILE_KIND, version: 1, name: l.name, terms: l.terms, glossary: l.glossary || '' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${l.name.replace(/[<>:"/\\|?*]+/g, '').trim() || 'Term list'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Term lists save themselves (they can be thousands of lines), separate from the Settings form.
export default function TermLists() {
  const { settings, reloadSettings } = useApp();
  const [lists, setLists] = useState(settings.termLists);
  const [status, setStatus] = useState(null); // 'saving' | 'saved' | error text
  useUnsaved(JSON.stringify(lists) !== JSON.stringify(settings.termLists));
  const timer = useRef();
  const first = useRef(true);
  const importInput = useRef();
  const [aiOpen, setAiOpen] = useState(false);
  const [open, setOpen] = useState(readOpen);
  const toggle = (id) => setOpen((ids) => { const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]; writeOpen(next); return next; });

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

  const add = (list) => {
    const id = crypto.randomUUID();
    setLists((ls) => [...ls, { id, name: 'New list', terms: '', glossary: '', ...list }]);
    setOpen((ids) => { const next = [...ids, id]; writeOpen(next); return next; });
  };
  const importList = async (file) => {
    setStatus(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // Our own export, as saved; anything else (e.g. a file saved from an AI's answer) goes through the forgiving parser.
      if (data?.kind === FILE_KIND && typeof data.terms === 'string') add({ name: String(data.name || 'Imported list'), terms: data.terms, glossary: typeof data.glossary === 'string' ? data.glossary : '' });
      else add(parseTermListAnswer(text, file.name.replace(/.[^.]+$/, '')));
    } catch {
      setStatus('That file is not a term list exported from Nico\'s Transcriber. To add names from any .txt/.csv/.json, drop it on a list\'s "All terms" box.');
    }
  };
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
        <button type="button" onClick={() => setAiOpen(true)}><Icon name="star" /> Build with AI</button>
        <button type="button" onClick={() => importInput.current.click()}><Icon name="upload" /> Import list</button>
        <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importList(f); }} />
        <button type="button" onClick={addMinecraft} disabled={loadingMc}>{loadingMc ? 'Downloading…' : <><Icon name="download" /> Vanilla Minecraft list</>}</button>
        <button type="button" onClick={() => add({})}><Icon name="plus" /> New list</button>
      </div>
      {status && status !== 'saving' && status !== 'saved' && <div className="error">{status}</div>}
      <p className="muted small">
        One list per game or modpack. Tick lists when you transcribe. <strong>Priority terms</strong> (up to ~100) are sent to the transcriber so it spells them right.{' '}
        <strong>All terms</strong> can be thousands of names (every item, mob, mod…). They're used afterwards to catch sound-alike mistakes and by the AI proofread.
      </p>
      {aiOpen && <AiTermListDialog onClose={() => setAiOpen(false)} onCreate={(list) => add(list)} />}
      {!lists.length && <p className="muted small">No lists yet. <button type="button" className="link-btn" onClick={() => setAiOpen(true)}>Build one with AI</button> for any game in a couple of minutes.</p>}
      {lists.map((l) => (
        <div key={l.id} className={`term-list ${open.includes(l.id) ? 'open' : 'closed'}`}>
          <div className="row">
            <button type="button" className="icon-btn list-toggle" aria-expanded={open.includes(l.id)} aria-label={`${open.includes(l.id) ? 'Collapse' : 'Expand'} ${l.name}`} onClick={() => toggle(l.id)}>
              <Icon name="chevron" />
            </button>
            {open.includes(l.id) ? (
              <input className="grow list-name" aria-label="List name" value={l.name} onChange={(e) => update(l.id, { name: e.target.value })} />
            ) : (
              <button type="button" className="grow list-summary" onClick={() => toggle(l.id)}>
                <strong>{l.name || 'Untitled list'}</strong>
                <span className="muted small">{priorityCount(l)} priority · {glossaryCount(l).toLocaleString()} terms</span>
              </button>
            )}
            <button type="button" className="ghost small-btn" title="Save this list as a file to share" onClick={() => exportList(l)}><Icon name="download" /> Export</button>
            <button type="button" className="ghost small-btn" onClick={() => remove(l.id, l.name)}>Delete</button>
          </div>
          {open.includes(l.id) && <>
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
          </>}
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
