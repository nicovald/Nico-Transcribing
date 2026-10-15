// Free, instant glossary check: finds transcript phrases that *sound like* a glossary
// term but are spelled differently ("Couples Stone" ~ "Cobblestone", "silicone" ~ "Silicon").
// Works on thousands of terms without any API call.

import { occurrenceFor, phraseRanges, textTokens } from './ranges.js';

// A rough phonetic key: similar-sounding consonants share a code, vowels are dropped
// (except a leading one), repeats collapse. "cobblestone" and "couples stone" both -> KPLSTN.
export function soundKey(text) {
  let s = text.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return '';
  s = s.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'k').replace(/th/g, 't').replace(/sh|ch/g, 's');
  const lead = /[aeiouy]/.test(s[0]) ? 'A' : '';
  const map = { b: 'P', p: 'P', d: 'T', t: 'T', c: 'K', g: 'K', k: 'K', q: 'K', x: 'K', j: 'J', f: 'F', v: 'F', s: 'S', z: 'S', m: 'N', n: 'N', l: 'L', r: 'R' };
  let out = lead;
  for (const ch of s) {
    const code = map[ch];
    if (code && out.at(-1) !== code) out += code;
  }
  return out;
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const letters = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const vowels = (s) => letters(s).replace(/[^aeiouy]/g, '');

function lcsLength(a, b) {
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = tmp;
    }
  }
  return prev[b.length];
}

// The sound a word starts with, so "Kraner"/"Crainer", "Fil"/"Phil", "Jeff"/"Geoff" count as the same start.
function leadSound(s) {
  if (/^ph/.test(s)) return 'f';
  if (/^wh/.test(s)) return 'w';
  if (/^c[eiy]/.test(s)) return 's'; // soft c
  return { c: 'k', q: 'k', z: 's', j: 'g', y: 'i' }[s[0]] || s[0];
}

// Beyond sounding alike, a real mishearing keeps the first sound, covers most of the
// term, and has a similar vowel pattern ("strange" is not a mishearing of "String").
function looksAlike(phrase, term, maxDist = 0.35, allowSame = false) {
  const a = letters(phrase);
  const b = letters(term);
  if (a[0] !== b[0] && leadSound(a) !== leadSound(b)) return false;
  if (Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.75) return false;
  const dist = levenshtein(a, b);
  if ((dist === 0 && !allowSame) || dist / Math.max(a.length, b.length) > maxDist) return false;
  const va = vowels(phrase);
  const vb = vowels(term);
  return lcsLength(va, vb) / Math.max(va.length, vb.length, 1) >= 0.5;
}
const stripEdges = (s) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// Everyday words that would otherwise get "corrected" into a similar-sounding game term.
export const COMMON = new Set(
  `about above after again against also always another anything around away back because been before being below better between both bring built but call came can come could day did does doing done down each even every find first from gave give going gone good got great had has have having here high him his home how into its just keep kind know last left let life like line little long look made make many maybe more most much must name need never new next nice now off okay old once only open other our out over own part people place play point put quite really right said same saw say see seem set should show side since small some something still such sure take tell than thank that their them then there these thing think this those though thought three through time today together told too took turn two under until upon use used very wait want was watch water way well went were what when where which while who why will with without word work world would wrong yeah year yes yet you your`.split(' '),
);

// terms: array of glossary strings. Returns [{ cueId, from, to, reason }].
// names: people's names are short ("Crainer", "Lookum"), so shorter keys are allowed but the
// spelling must be closer, and "Look um" -> "Lookum" or "Craners" -> "Crainer's" count.
export function glossaryCheck(cues, terms, { names = false } = {}) {
  const minLetters = names ? 4 : 5, minKey = names ? 3 : 4, maxDist = names ? 0.25 : 0.35;
  const byKey = new Map();
  const exact = new Set();
  for (const term of terms) {
    const t = term.trim();
    if (letters(t).length < minLetters) continue;
    const key = soundKey(t);
    if (key.replace('A', '').length < minKey) continue; // short keys match too many ordinary words
    // Several terms can share a sound key ("Kroner", "Crainer"); keep them all, in list order
    // (priority terms come first, so they win ties).
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(t);
    exact.add(letters(t));
  }
  if (!byKey.size) return [];
  // The closest-spelled candidate that still looks like a mishearing of it.
  const pick = (base, key, allowSame) => {
    let best = null, bestDist = Infinity;
    for (const t of byKey.get(key) || []) {
      if (!looksAlike(base, t, maxDist, allowSame)) continue;
      const d = levenshtein(letters(base), letters(t));
      if (d < bestDist) (best = t), (bestDist = d);
    }
    return best;
  };

  const out = [];
  for (const cue of cues) {
    // Phrases the user already accepted or typed on this cue (cue.locked) are left alone, matched by
    // character range. Older edited cues have no `locked` list and are skipped entirely, as before.
    if (cue.edited && !Array.isArray(cue.locked)) continue;
    const tokens = textTokens(cue.text);
    const words = tokens.map((t) => t.text);
    const taken = new Array(words.length).fill(false);
    // Longest phrases first, so "Couples Stone" wins over "Stone".
    for (let n = 4; n >= 1; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        if (taken.slice(i, i + n).some(Boolean)) continue;
        const phrase = stripEdges(words.slice(i, i + n).join(' '));
        const flat = letters(phrase);
        if (!flat || (exact.has(flat) && !(names && n > 1))) continue;
        if (n === 1 && COMMON.has(flat)) continue;
        const at = phraseRanges(cue.text, phrase).findIndex(([st]) => st >= tokens[i].start && st < tokens[i].end);
        const occurrence = at < 0 ? -1 : occurrenceFor(cue, phrase, at);
        if (occurrence < 0) continue; // overlaps words the user set by hand
        let base = phrase, suffix = '';
        let term = pick(phrase, soundKey(phrase), names && n > 1);
        const possessive = names && !term && phrase.match(/^(.+?)('s|s)$/iu);
        if (possessive && !exact.has(letters(possessive[1]))) {
          base = possessive[1];
          suffix = "'s";
          term = pick(base, soundKey(base), names && n > 1);
        }
        if (!term) continue;
        out.push({ cueId: cue.id, from: phrase, to: term + suffix, occurrence, reason: 'Sounds like a glossary term' });
        for (let k = i; k < i + n; k++) taken[k] = true;
      }
    }
  }
  return out;
}

// Builds a picker that, for a piece of transcript, returns the glossary terms worth showing
// the AI proofreader: ones sharing an unusual word with the text, or sounding like a phrase in it.
// Keeps prompts small even with 10,000+ modded names.
export function termPicker(terms) {
  const tokenize = (s) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
  // Words used in many names ("block", "ingot", "gold", "bee") say nothing about which term is meant.
  const df = new Map();
  for (const t of terms) for (const w of new Set(tokenize(t))) df.set(w, (df.get(w) || 0) + 1);
  const informative = (w) => w.length >= 4 && !COMMON.has(w) && (df.get(w) || 0) <= 15;

  const byWord = new Map(); // word or its sound key -> terms
  const add = (k, t) => {
    if (!byWord.has(k)) byWord.set(k, new Set());
    byWord.get(k).add(t);
  };
  const byPhraseKey = new Map(); // whole-term sound key -> terms sharing it
  for (const t of terms) {
    for (const w of tokenize(t)) {
      if (!informative(w)) continue;
      add(w, t);
      const k = soundKey(w);
      if (k.replace('A', '').length >= 3) add(`#${k}`, t);
    }
    const pk = soundKey(t);
    if (pk.replace('A', '').length < 4) continue;
    if (!byPhraseKey.has(pk)) byPhraseKey.set(pk, []);
    byPhraseKey.get(pk).push(t);
  }

  return (text, max = 400) => {
    const words = tokenize(text);
    const score = new Map();
    const bump = (set, n) => set && set.forEach((t) => score.set(t, (score.get(t) || 0) + n));
    for (let i = 0; i < words.length; i++) {
      bump(byWord.get(words[i]), 3);
      bump(byWord.get(`#${soundKey(words[i])}`), 1);
      for (let n = 1; n <= 4 && i + n <= words.length; n++) {
        const phrase = words.slice(i, i + n).join('');
        const candidates = byPhraseKey.get(soundKey(phrase));
        if (!candidates) continue;
        // Every term with this sound is worth showing; the closest spelling ranks highest
        // (the first one in list order on a tie, so priority terms win).
        const dist = candidates.map((t) => levenshtein(letters(phrase), letters(t)));
        const best = candidates[dist.indexOf(Math.min(...dist))];
        for (const t of candidates) score.set(t, (score.get(t) || 0) + (t === best ? 4 : 3));
      }
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([t]) => t);
  };
}

// Parse a pasted or dropped list: one per line, commas, CSV cells, or JSON
// (array of strings, or objects with displayName/name).
export function parseTermList(text) {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      const data = JSON.parse(trimmed);
      const arr = Array.isArray(data) ? data : Object.values(data);
      return dedupe(arr.map((x) => (typeof x === 'string' ? x : x?.displayName || x?.name || '')));
    } catch {
      // Not JSON after all; fall through to line parsing.
    }
  }
  return dedupe(splitCells(trimmed));
}

// Splits on newlines, commas, semicolons and tabs, but a "quoted, cell" stays one term
// ("Bucket of Salmon, Raw"); "" inside quotes is a literal quote, as in CSV.
function splitCells(text) {
  const out = [];
  let cell = '', quoted = false, wasQuoted = false;
  const end = () => {
    out.push(wasQuoted ? cell : cell.replace(/^\s*["']|["']\s*$/g, ''));
    cell = '';
    wasQuoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else if (ch === '\n' || ch === '\r') (quoted = false), end(); // a stray quote never swallows the next lines
      else cell += ch;
    } else if (ch === '"' && !cell.trim()) {
      quoted = wasQuoted = true;
      cell = '';
    } else if (/[\r\n,;\t]/.test(ch)) end();
    else cell += ch;
  }
  end();
  return out;
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = String(raw).trim();
    if (!t || t.length > 60 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}
