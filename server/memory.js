// What the app learns across transcripts: fixes editors keep making ("couples stone" -> "Cobblestone")
// and the people who are usually in the videos. Stored in data/memory.json, shareable as a file.
//
// fix:    { id, from, to, fixed, ignored, pin: null|'usual'|'unsure'|'never', updatedAt }
// person: { id, name, aka: [real names], heardAs: [known mishearings] }
import path from 'node:path';
import * as store from './store.js';
import { COMMON, glossaryCheck } from './glossary.js';
import { badRequest } from './validation.js';

const FILE = path.join(store.DATA_DIR, 'memory.json');
const EMPTY = { people: [], fixes: [] };
const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const norm = (s) => clean(s).toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '');
const keyOf = (from, to) => `${norm(from)}|${norm(to)}`;
// Style edits, not mishearings.
const CASUAL = new Set('gonna wanna gotta kinda sorta dunno lemme gimme yeah yep yup nope nah okay umm uhh hmm alright ain\'t y\'all'.split(' '));

// "Usually this" after 3+ fixes that were almost never ignored; "not sure" while it is mostly fixed.
export function tierOf(fix) {
  if (fix.pin) return fix.pin === 'never' ? null : fix.pin;
  const total = fix.fixed + fix.ignored;
  if (fix.fixed >= 3 && fix.fixed / total >= 0.9) return 'usual';
  if (fix.fixed >= 1 && fix.fixed / total >= 0.5) return 'unsure';
  return null;
}

export function getMemory() {
  const saved = store.readJson(FILE, null);
  if (saved) return { people: saved.people || [], fixes: saved.fixes || [] };
  // First run starts empty; a studio shares its people list through the settings file (Ctrl+Shift+T).
  return save(structuredClone(EMPTY));
}
const save = (memory) => { store.writeJson(FILE, memory); return memory; };
export const memoryView = (memory = getMemory()) => ({ ...memory, fixes: memory.fixes.map((f) => ({ ...f, tier: tierOf(f) })) });

// Called on every Fix / Ignore / hand edit. Tiny wording changes (case, punctuation) are not lessons.
export function recordFix(from, to, { fixed = 0, ignored = 0 } = {}) {
  from = clean(from); to = clean(to);
  if (!from || !to || norm(from) === norm(to) || from.length > 60 || to.length > 60) return;
  // "a" -> "the" or "gonna" -> "going to" would flag half of every transcript.
  if (norm(from).split(' ').every((w) => w.length < 3 || COMMON.has(w.replace(/'/g, '')) || CASUAL.has(w))) return;
  const memory = getMemory();
  let fix = memory.fixes.find((f) => keyOf(f.from, f.to) === keyOf(from, to));
  if (!fix) {
    if (!fixed) return; // Ignoring something we never learned teaches nothing.
    fix = { id: crypto.randomUUID(), from, to, fixed: 0, ignored: 0, pin: null };
    memory.fixes.push(fix);
  }
  fix.fixed += fixed;
  fix.ignored += ignored;
  fix.updatedAt = new Date().toISOString();
  save(memory);
}

const words = (s) => s.split(/\s+/).filter(Boolean);
const bare = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const edgeTrim = (s) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// A hand edit that swaps a few words ("couples stone" -> "Cobblestone") is a fix worth remembering.
// Rewrites of a whole line are not: only 1-2 short changed spans count.
export function learnedFromEdit(before, after) {
  const a = words(before), b = words(after);
  let s = 0;
  while (s < a.length && s < b.length && bare(a[s]) === bare(b[s])) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && bare(a[a.length - 1 - e]) === bare(b[b.length - 1 - e])) e++;
  const from = edgeTrim(a.slice(s, a.length - e).join(' '));
  const to = edgeTrim(b.slice(s, b.length - e).join(' '));
  const n = (x) => words(x).length;
  if (!from || !to || n(from) > 4 || n(to) > 4) return null;
  return { from, to };
}

// Suggestions from memory for these lines. Learned fixes match exactly; people also match by sound
// ("Craner" -> "Crainer", "Look um" -> "Lookum"), and possessives keep their 's.
export function memoryCheck(cues, memory = getMemory()) {
  const out = [];
  const seen = new Set();
  const push = (s) => {
    const k = `${s.cueId}|${norm(s.from)}`;
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  };
  const fixes = memory.fixes.map((f) => ({ ...f, tier: tierOf(f) })).filter((f) => f.tier);
  const people = memory.people.flatMap((p) => p.heardAs.map((h) => ({ from: h, to: p.name, person: p })));
  const phraseRe = (from) => new RegExp(`(?<![\\p{L}\\p{N}])${from.trim().split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}(?![\\p{L}\\p{N}])`, 'iu');
  for (const cue of cues) {
    if (cue.edited) continue;
    for (const f of fixes) {
      const m = cue.text.match(phraseRe(f.from));
      if (!m || m[0].replace(/\s+/g, ' ') === f.to) continue;
      push({ cueId: cue.id, from: m[0].replace(/\s+/g, ' '), to: f.to, tier: f.tier, source: 'learned', sourceLabel: 'Learned', reason: `Fixed ${f.fixed} of ${f.fixed + f.ignored} times before` });
    }
    for (const h of people) {
      const m = cue.text.match(phraseRe(h.from));
      if (m) push({ cueId: cue.id, from: m[0].replace(/\s+/g, ' '), to: h.to, tier: 'unsure', source: 'people', sourceLabel: 'People', reason: `Often misheard name` });
    }
  }
  const names = memory.people.map((p) => p.name);
  if (names.length) {
    for (const g of glossaryCheck(cues, names, { names: true })) push({ ...g, tier: 'unsure', source: 'people', sourceLabel: 'People', reason: 'Sounds like a name on your people list' });
  }
  return out;
}

// Spelled right by the transcriber in the first place: names first, then confident learned fixes.
export function memoryKeyterms(memory = getMemory()) {
  const usual = memory.fixes.filter((f) => tierOf(f) === 'usual').map((f) => f.to);
  return [...new Set([...memory.people.map((p) => p.name), ...usual])];
}

// For the AI proofreader: "SSundee (real name Ian)".
export const peopleContext = (memory = getMemory()) =>
  memory.people.map((p) => (p.aka.length ? `${p.name} (also called ${p.aka.join(', ')})` : p.name)).join(', ');

// ---------------------------------------------------------------- editing, sharing

const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/)).map(clean).filter(Boolean);
const PINS = [null, 'usual', 'unsure', 'never'];

function validPerson(p) {
  if (!p || typeof p !== 'object' || !clean(p.name)) throw badRequest('Every person needs a name.');
  if (clean(p.name).length > 60) throw badRequest('Names can be up to 60 characters.');
  return { id: typeof p.id === 'string' && p.id ? p.id : crypto.randomUUID(), name: clean(p.name), aka: list(p.aka), heardAs: list(p.heardAs) };
}
function validFix(f) {
  if (!f || typeof f !== 'object' || !clean(f.from) || !clean(f.to)) throw badRequest('Each fix needs what was heard and what it should be.');
  if (!PINS.includes(f.pin ?? null)) throw badRequest('Unknown fix setting.');
  const count = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);
  return { id: typeof f.id === 'string' && f.id ? f.id : crypto.randomUUID(), from: clean(f.from), to: clean(f.to), fixed: count(f.fixed), ignored: count(f.ignored), pin: f.pin ?? null, updatedAt: f.updatedAt || new Date().toISOString() };
}

export function savePeople(people) {
  if (!Array.isArray(people)) throw badRequest('People must be a list.');
  const memory = getMemory();
  memory.people = people.map(validPerson);
  return memoryView(save(memory));
}
export function updateFix(id, patch) {
  const memory = getMemory();
  const fix = memory.fixes.find((f) => f.id === id);
  if (!fix) throw Object.assign(new Error('That learned fix was removed.'), { status: 404 });
  Object.assign(fix, validFix({ ...fix, ...patch, id }));
  return memoryView(save(memory));
}
export function addFix(f) {
  const memory = getMemory();
  const fix = validFix({ ...f, id: null, fixed: 0, ignored: 0, pin: f.pin ?? 'usual' });
  if (memory.fixes.some((x) => keyOf(x.from, x.to) === keyOf(fix.from, fix.to))) throw badRequest('That fix is already on the list.');
  memory.fixes.push(fix);
  return memoryView(save(memory));
}
export function deleteFix(id) {
  const memory = getMemory();
  memory.fixes = memory.fixes.filter((f) => f.id !== id);
  return memoryView(save(memory));
}

// "grok-transcriber-*" file kinds predate the rename; kept so older exported files still import.
export const exportMemory = () => ({ kind: 'grok-transcriber-memory', version: 1, exportedAt: new Date().toISOString(), ...getMemory() });

// Merging a teammate's file: people join by name, fixes by from/to. Counts take the larger side,
// so importing the same file twice changes nothing. Your own pins win.
export function importMemory(data) {
  if (!data || data.kind !== 'grok-transcriber-memory') throw badRequest("This is not a memory file exported from Nico's Transcriber.");
  const memory = getMemory();
  let people = 0, fixes = 0;
  for (const raw of Array.isArray(data.people) ? data.people : []) {
    const p = validPerson({ ...raw, id: null });
    const mine = memory.people.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (!mine) { memory.people.push(p); people++; continue; }
    const union = (a, b) => [...new Map([...a, ...b].map((v) => [v.toLowerCase(), v])).values()];
    mine.aka = union(mine.aka, p.aka);
    mine.heardAs = union(mine.heardAs, p.heardAs);
  }
  for (const raw of Array.isArray(data.fixes) ? data.fixes : []) {
    const f = validFix({ ...raw, id: null });
    const mine = memory.fixes.find((x) => keyOf(x.from, x.to) === keyOf(f.from, f.to));
    if (!mine) { memory.fixes.push(f); fixes++; continue; }
    mine.fixed = Math.max(mine.fixed, f.fixed);
    mine.ignored = Math.max(mine.ignored, f.ignored);
    mine.pin ??= f.pin;
  }
  save(memory);
  return { people, fixes, memory: memoryView(memory) };
}

