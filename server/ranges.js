// Pure text-range helpers shared by the checkers (no storage). Re-exported from transcript.js.
// ---------------------------------------------------------------- locked phrases
//
// cue.locked: string[] — text the user put into this line on purpose: the replacement of every
// accepted Fix, the words of every hand edit, the text of an added missed line. Checkers
// (compare, learned fixes/people, glossary) still look at edited lines, but must skip any
// candidate whose matched words overlap one of these phrases. Use occurrenceFor(cue, from) to
// pick a free match (or overlapsLocked(cue, start, end) with a character range in cue.text).
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const edgeTrim = s => String(s ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// Matches `from` in cue text as whole words, tolerating line breaks and case.
export function phraseRegex(from, flags = 'iu') {
  const tokens = from.trim().split(/\s+/).map(escapeRe);
  return new RegExp(`(?<![\\p{L}\\p{N}])${tokens.join('\\s+')}(?![\\p{L}\\p{N}])`, flags);
}
// Character ranges [start, end) of every whole-word match of `phrase` in `text`.
export function phraseRanges(text, phrase) {
  if (!text || !phrase?.trim()) return [];
  return [...text.matchAll(phraseRegex(phrase, 'giu'))].map(m => [m.index, m.index + m[0].length]);
}
export const lockedRanges = cue => (cue.locked || []).map(edgeTrim).filter(Boolean).flatMap(l => phraseRanges(cue.text, l));
export const overlapsLocked = (cue, start, end) => lockedRanges(cue).some(([s, e]) => start < e && s < end);
// Which match of `from` a suggestion should target. With `preferred`, exactly that match, else the
// first match the user has not locked. -1 means skip it (never a different match as a fallback).
export function occurrenceFor(cue, from, preferred) {
  const ranges = phraseRanges(cue.text, from);
  if (!ranges.length) return -1;
  const locked = lockedRanges(cue);
  const free = ([s, e]) => !locked.some(([ls, le]) => s < le && ls < e);
  if (preferred != null) return Number.isInteger(preferred) && ranges[preferred] && free(ranges[preferred]) ? preferred : -1;
  return ranges.findIndex(free);
}
// Whitespace-separated tokens of a text with their character offsets [start, end).
export const textTokens = text => [...String(text ?? '').matchAll(/\S+/g)].map(m => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
// Replaces character ranges right to left, so earlier offsets stay valid.
export function replaceRanges(text, ranges, to) {
  return [...ranges].sort((a, b) => b[0] - a[0]).reduce((t, [s, e]) => t.slice(0, s) + to + t.slice(e), text);
}

// ---------------------------------------------------------------- suggestion targets
//
// A word suggestion targets one match of `from` (s.occurrence) in s.cueText, the line text it was
// made for. When the line changes, rebaseSuggestion keeps it on the same words (they sat outside the
// changed stretch) or reports that it no longer applies. It never jumps to another match.

// Range [start, end) the suggestion targets in the cue as it is now, or null (gone, moved or locked).
export function suggestionRange(cue, s) {
  if (!cue || (s.cueText != null && s.cueText !== cue.text)) return null;
  const r = phraseRanges(cue.text, s.from)[s.occurrence ?? 0];
  return r && !overlapsLocked(cue, r[0], r[1]) ? r : null;
}
// Moves s onto cue.text after the line changed. Returns false when its words were changed or are gone.
export function rebaseSuggestion(s, cue) {
  if (s.cueText == null || s.cueText === cue.text) {
    if (!suggestionRange(cue, s)) return false;
    s.cueText = cue.text;
    return true;
  }
  const a = s.cueText, b = cue.text;
  const old = phraseRanges(a, s.from)[s.occurrence ?? 0];
  if (!old) return false;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  // Changed stretch is [p, a.length - q) in the old text; the target must sit wholly outside it.
  let at;
  if (old[1] <= p) at = old[0];
  else if (old[0] >= a.length - q) at = old[0] + b.length - a.length;
  else return false;
  // Another copy of the phrase inside the changed stretch (either side) makes the diff ambiguous:
  // "Craner left; Craner stayed" minus its first clause looks the same as minus the last words.
  // Then we cannot tell which copy was ours, so it goes stale rather than risk the wrong person.
  const inside = (text, from, to) => phraseRanges(text, s.from).some(([st, en]) => st >= from && en <= to);
  if (inside(a, p, a.length - q) || inside(b, p, b.length - q)) return false;
  const i = phraseRanges(b, s.from).findIndex(([st]) => st === at);
  if (i < 0) return false;
  s.occurrence = i;
  s.cueText = b;
  return !!suggestionRange(cue, s);
}
// Replaces `ranges` of cue.text with `to` (an edit whose ranges we know exactly) and moves the other
// suggestions (open or dismissed) through it by shifting their offsets, so one fix never hides the
// rest. A suggestion whose words overlap the edit, or that was already stale, is left behind (it
// keeps its old cueText and so reads as changed).
export function replaceKnownRanges(cue, ranges, to, others) {
  const before = cue.text;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const pending = [];
  for (const x of others) {
    if (!rebaseSuggestion(x, cue)) continue;
    const r = suggestionRange(cue, x);
    if (!r || sorted.some(([s, e]) => r[0] < e && s < r[1])) continue;
    const shift = sorted.filter(([, e]) => e <= r[0]).reduce((n, [s, e]) => n + to.length - (e - s), 0);
    pending.push([x, r[0] + shift]);
  }
  cue.text = replaceRanges(before, ranges, to);
  for (const [x, at] of pending) {
    const i = phraseRanges(cue.text, x.from).findIndex(([st]) => st === at);
    if (i < 0) { x.cueText = before; continue; }
    x.occurrence = i;
    x.cueText = cue.text;
  }
}
// Adds a phrase to cue.locked (no duplicates).
export function lockPhrase(cue, phrase) {
  const p = edgeTrim(phrase).replace(/\s+/g, ' ');
  if (!p) return;
  const list = cue.locked || [];
  if (!list.some(l => l.toLowerCase() === p.toLowerCase())) cue.locked = [...list, p];
}
