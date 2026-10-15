// Finding likely mis-transcriptions ("Couples Stone" -> "Cobblestone").
//
// Candidates come from two finders:
//   - AI proofread: a Grok text model reads the transcript with the project context.
//   - Compare: a second provider's words are aligned against this job's words.
// An optional verifier (TypeSafe Jev) then scores each candidate with a calibrated probability.
//
// Suggestion: { id, cueId, from, to, occurrence?, kind?, source: 'ai'|'compare'|..., sourceLabel, reason,
//               verified: number|null, status: 'open'|'accepted'|'dismissed'|'stale' }
//   occurrence: which match of `from` in the line is meant (0-based; missing = first).
//   kind 'insert':      the other service heard extra words inside the line ("get stone" -> "get more stone").
//   kind 'insert-line': words heard where this transcript has no line at all:
//                       { cueId: null, track, start, end, text, words, from: '', to: text }.
//   cueText: the line text the suggestion was made for. Suggestions follow edits to the line (rebaseSuggestion)
//            and go stale when their words change; they never jump to a different match.
// Cues may carry `locked: string[]` (see transcript.js): words the user accepted or typed, never re-flagged.
import { providers } from './providers/index.js';
import { request } from './providers/http.js';
import { lockPhrase, occurrenceFor, overlapsLocked, phraseRegex, phraseRanges, rebaseSuggestion, replaceKnownRanges, replaceRanges, suggestionRange, textTokens, updateTranscript } from './transcript.js';
import { buildCues, joinWords } from './srt.js';
import { modelFor, pickProofreader } from './proofreaders.js';
import * as store from './store.js';
import { glossaryCheck, termPicker } from './glossary.js';
import { getMemory, memoryCheck, peopleContext, recordFix } from './memory.js';
import { readCues, readSuggestions, readWords, resolveGlossary, resolveKeyterms, isDeleting } from './jobs.js';

export { phraseRegex };

export function replacePhrase(text, from, to, all = false) {
  return text.replace(phraseRegex(from, all ? 'giu' : 'iu'), () => to);
}

// Replaces only the n-th match. A line with fewer matches is returned unchanged (never another match).
export function replaceOccurrence(text, from, to, occurrence = 0) {
  const range = phraseRanges(text, from)[occurrence];
  return range ? replaceRanges(text, [range], to) : text;
}

const containsPhrase = (text, from) => phraseRegex(from).test(text);

// ---------------------------------------------------------------- compare

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const stripEdges = (s) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// Classic LCS over two short token arrays; returns matched index pairs.
function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// Words one service drops and the other keeps all the time; never worth a flag on their own.
const FILLERS = new Set('um umm uh uhh uhm er erm ah eh oh hm hmm mm mhm like yeah'.split(' '));
const isFiller = (w) => FILLERS.has(norm(w.text));
const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// The words of a cue as they read NOW (edits included), with character offsets in cue.text.
// Timings come from the raw words when they still line up one-to-one, else are spread over the line.
function currentTokens(cue) {
  const toks = textTokens(cue.text);
  const same = toks.length === cue.words.length;
  const span = Math.max(cue.end - cue.start, 0);
  return toks.map((t, i) => ({
    text: t.text, cs: t.start, ce: t.end,
    start: same ? cue.words[i].start : cue.start + (span * i) / toks.length,
    end: same ? cue.words[i].end : cue.start + (span * (i + 1)) / toks.length,
  }));
}

// For each cue, align its current words with the other provider's words in the same time span
// and report stretches where the two heard different words, plus words only the other heard.
// Matching is settled across the whole track first, so a word that lines up with (or sits inside)
// another cue is never offered as an insertion into a different one.
// Then report stretches the other provider heard where this transcript has no line at all.
export function compareWords(cues, otherWordsByTrack, otherLabel) {
  const out = [];
  const matched = new Set(); // other-provider words that line up with one of our cues
  const plans = [];
  const draft = [];
  for (const cue of cues) {
    // Lines edited before locked phrases existed: we cannot tell which words the user typed.
    if (!cue.words?.length || (cue.edited && !Array.isArray(cue.locked))) continue;
    const window = (otherWordsByTrack[cue.track] || []).filter((w) => w.end > cue.start - 0.4 && w.start < cue.end + 0.4);
    const ours = currentTokens(cue);
    if (!window.length || !ours.length) continue;
    const lcs = lcsPairs(ours.map((t) => norm(t.text)), window.map((w) => norm(w.text)));
    draft.push({ cue, ours, window, lcs, hit: new Set(lcs.map(([, j]) => window[j])) });
  }
  // A word belongs to the line whose time span holds its midpoint (an insertion into line A is not a
  // correction of the next line B just because B's tolerance window reaches it). Inside several
  // overlapping lines it goes to the one that matched it, else the tightest one. Words outside every
  // line keep the tolerance window.
  const owner = new Map();
  for (const { cue, window, hit } of draft) for (const w of window) {
    const mid = (w.start + w.end) / 2;
    if (mid < cue.start || mid > cue.end) continue;
    const cur = owner.get(w);
    const better = !cur || (hit.has(w) && !cur.hit.has(w)) || (hit.has(w) === cur.hit.has(w) && cue.end - cue.start < cur.cue.end - cur.cue.start);
    if (better) owner.set(w, { cue, hit });
  }
  for (const d of draft) {
    const { cue, ours } = d;
    const other = d.window.filter((w) => !owner.has(w) || owner.get(w).cue === cue);
    if (!other.length) continue;
    const lcs = lcsPairs(ours.map((t) => norm(t.text)), other.map((w) => norm(w.text)));
    for (const [, j] of lcs) matched.add(other[j]);
    plans.push({ cue, ours, other, lcs });
  }

  // Two passes over all lines: first substitutions (our words vs theirs), so an overlapping line
  // claims its own corrected word before another line's insertion can take it; then insertions.
  const found = plans.map(() => []);
  for (const phase of ['sub', 'ins']) plans.forEach(({ cue, ours, other, lcs }, pi) => {
    // Which match of `from` starts in token `at`; -1 (skip) when it cannot be mapped or the user set it.
    const push = (from, to, at, extra = {}) => {
      if (!from || !to || !ours[at]) return;
      const idx = phraseRanges(cue.text, from).findIndex(([st]) => st >= ours[at].cs && st < ours[at].ce);
      const occurrence = idx < 0 ? -1 : occurrenceFor(cue, from, idx);
      if (occurrence < 0) return;
      found[pi].push({ k: curK, s: { cueId: cue.id, from, to, occurrence, source: 'compare', sourceLabel: otherLabel, ...extra } });
    };
    const pairs = [[-1, -1], ...lcs, [ours.length, other.length]];
    let curK = 0;

    for (let k = 0; k < pairs.length - 1; k++) {
      curK = k;
      const [ai, bi] = pairs[k];
      const [aj, bj] = pairs[k + 1];
      const aGap = ours.slice(ai + 1, aj);
      if (!aGap.length !== (phase === 'ins')) continue;
      // Words another cue already claimed are not missing from this one.
      let bGap = other.slice(bi + 1, bj).filter((w) => !matched.has(w));
      if (!bGap.length) continue; // we heard words they did not: ours may well be right
      const edge = k === 0 || k === pairs.length - 2;

      if (!aGap.length) {
        // They heard extra words inside this line. At the edges keep only words centred in the line.
        if (edge) bGap = bGap.filter((w) => { const c = (w.start + w.end) / 2; return c >= cue.start && c <= cue.end; });
        bGap.forEach((w) => matched.add(w));
        if (!bGap.length || bGap.every(isFiller)) continue;
        const left = ai >= 0 ? ours[ai] : null;
        const right = aj < ours.length ? ours[aj] : null;
        // "I I think": a repeated neighbour is a stutter, not a missing word.
        if (bGap.length === 1 && [left, right].some((n) => n && norm(n.text) === norm(bGap[0].text))) continue;
        let ins = stripEdges(bGap.map((w) => w.text).join(' '));
        if (!ins || (!left && !right)) continue;
        if (!left && /^\p{Lu}/u.test(right.text) && /^\p{Ll}/u.test(ins)) ins = capitalize(ins);
        const from = stripEdges([left?.text, right?.text].filter(Boolean).join(' '));
        const to = stripEdges([left?.text, ins, right?.text].filter(Boolean).join(' '));
        push(from, to, left ? ai : aj, { kind: 'insert', reason: `${otherLabel} also heard "${ins}"` });
        continue;
      }

      // At the cue edges, only keep the other provider's words that overlap in time.
      if (edge) {
        const s = aGap[0].start - 0.25;
        const e = aGap[aGap.length - 1].end + 0.25;
        bGap = bGap.filter((w) => w.end > s && w.start < e);
        if (!bGap.length) continue;
      }
      bGap.forEach((w) => matched.add(w));
      const from = stripEdges(aGap.map((w) => w.text).join(' '));
      let to = stripEdges(bGap.map((w) => w.text).join(' '));
      if (!from || !to) continue;
      // "cobble stone" vs "cobblestone", "OK" vs "okay"-level noise is not worth a flag.
      if (norm(from.replace(/\s/g, '')) === norm(to.replace(/\s/g, ''))) continue;
      if (/^\p{Lu}/u.test(from) && /^\p{Ll}/u.test(to)) to = capitalize(to);
      push(from, to, ai + 1, { reason: `${otherLabel} heard "${to}"` });
    }
  });
  for (const list of found) out.push(...list.sort((a, b) => a.k - b.k).map(x => x.s));
  out.push(...missingLines(cues, otherWordsByTrack, otherLabel, matched));
  return out;
}

// Stretches of 2+ real words the other provider heard where this track has no line at all.
export function missingLines(cues, otherWordsByTrack, otherLabel, matched = new Set()) {
  const out = [];
  for (const [trackKey, words] of Object.entries(otherWordsByTrack)) {
    const track = Number(trackKey);
    const mine = cues.filter((c) => c.track === track).sort((x, y) => x.start - y.start);
    if (!mine.length || !words?.length) continue; // a failed or empty track is not "missed lines"
    const covered = (s, e) => mine.some((c) => e > c.start && s < c.end);
    const runs = [];
    let run = null;
    for (const w of [...words].sort((x, y) => x.start - y.start)) {
      if (matched.has(w) || covered(w.start, w.end)) { run = null; continue; }
      const prev = run?.at(-1);
      const breaks = !prev || w.start - prev.end > 1.0 || w.end - run[0].start > 7 || run.length >= 14 || covered(prev.end, w.start);
      if (breaks) runs.push((run = []));
      run.push(w);
    }
    for (const r of runs) {
      if (r.filter((w) => !isFiller(w)).length < 2) continue;
      const text = capitalize(r.map((w) => w.text.trim()).join(' ').replace(/\s+/g, ' ').trim());
      const start = r[0].start, end = Math.max(...r.map((w) => w.end)); // a long word can end after a later one
      if (!text || end <= start) continue;
      out.push({
        kind: 'insert-line', cueId: null, track, start, end, text, from: '', to: text,
        words: r.map(({ text, start, end, confidence = null, speaker = null }) => ({ text, start, end, confidence, speaker })),
        source: 'compare', sourceLabel: otherLabel, reason: `${otherLabel} heard words here that have no subtitle`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- AI proofread

const PROOFREAD_SCHEMA = {
  type: 'object',
  properties: {
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Line id exactly as given' },
          from: { type: 'string', description: 'Exact words from the line that were misheard' },
          to: { type: 'string', description: 'What was most likely actually said' },
          reason: { type: 'string', description: 'Very short reason, e.g. "Minecraft block"' },
        },
        required: ['id', 'from', 'to', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['fixes'],
  additionalProperties: false,
};

function proofreadPrompt(context, priorityTerms) {
  return [
    'You check automatic speech-recognition (ASR) subtitles for words the ASR misheard.',
    'Find ONLY likely mis-hearings: words that sound like what was really said but make no sense in context,',
    'e.g. "Couples Stone" -> "Cobblestone" in a Minecraft video, misspelled player/channel names, game items, slang.',
    'Do NOT fix grammar, style, profanity, filler words, casual speech, or punctuation. Do NOT rephrase.',
    'Only report fixes you are fairly confident about. "from" must be copied exactly from the line.',
    'When a fix is a game/mod name, spell it exactly as in the name lists given.',
    'Words written like [?word] are words the speech service was unsure it heard right. They are more likely to be misheard,',
    'but only fix them if they really look wrong. Copy "from" without the [? ] marks.',
    'Lines listed under "Context" are earlier lines shown only for meaning. Never report fixes for them.',
    context ? `What this video is: ${context}` : '',
    priorityTerms.length ? `Key names in this video: ${priorityTerms.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const CHUNK_LINES = 150;
const CONTEXT_LINES = 8;
const unmark = (s) => String(s ?? '').replace(/\[\?([^\]]*)\]/g, '$1').replace(/\[\?|\]/g, '');

// Line text for the model, with words the speech service was unsure of marked as [?word].
export function markedText(cue, threshold) {
  const text = cue.text.replace(/\s*\n\s*/g, ' ');
  const low = (w) => w.confidence != null && w.confidence < threshold;
  if (threshold == null || cue.edited || !cue.words?.some(low)) return text;
  const tokens = text.split(/\s+/);
  if (tokens.length === cue.words.length) return tokens.map((t, i) => (low(cue.words[i]) ? `[?${t}]` : t)).join(' ');
  const unsure = new Set(cue.words.filter(low).map((w) => w.text.trim()));
  return tokens.map((t) => (unsure.has(t) ? `[?${t}]` : t)).join(' ');
}

// One video, one track at a time, in time order; each chunk repeats the previous few lines as context.
// tracks: job.tracks (with optional mediaName), to group by video and label the chunk.
export function proofreadChunks(cues, tracks = []) {
  const mediaOrder = (pos) => {
    const id = tracks[pos]?.mediaId;
    const i = id == null ? -1 : tracks.findIndex((t) => t.mediaId === id);
    return i < 0 ? pos : i;
  };
  const multiVideo = new Set(tracks.map((t) => t.mediaId)).size > 1;
  const label = (pos) => {
    const t = tracks[pos];
    if (!t) return `Track ${pos + 1}`;
    const name = t.label || `Track ${pos + 1}`;
    return multiVideo && t.mediaName ? `${t.mediaName} · ${name}` : name;
  };
  const groups = new Map();
  for (const c of cues) {
    if (!groups.has(c.track)) groups.set(c.track, []);
    groups.get(c.track).push(c);
  }
  const chunks = [];
  for (const pos of [...groups.keys()].sort((a, b) => mediaOrder(a) - mediaOrder(b) || a - b)) {
    const lines = groups.get(pos).sort((a, b) => a.start - b.start);
    for (let i = 0; i < lines.length; i += CHUNK_LINES) {
      chunks.push({ track: pos, label: label(pos), context: lines.slice(Math.max(0, i - CONTEXT_LINES), i), lines: lines.slice(i, i + CHUNK_LINES) });
    }
  }
  return chunks;
}

async function proofreadChunk(chunk, { proofreader, key, model, system, pickTerms, threshold, signal }) {
  const fmt = (c) => `${c.id} | ${markedText(c, threshold)}`;
  const transcript = chunk.lines.map(fmt).join('\n');
  // Only the glossary names that plausibly relate to these lines, so huge modpack lists stay affordable.
  const related = pickTerms ? pickTerms(transcript) : [];
  const user = [
    `Track: ${chunk.label}`,
    related.length ? `Other names from this game/modpack that may be relevant: ${related.join(', ')}` : '',
    chunk.context.length ? `Context (do not fix these):\n${chunk.context.map(fmt).join('\n')}` : '',
    `Lines to check:\n${transcript}`,
  ].filter(Boolean).join('\n\n');
  const result = await proofreader.run({ key, model, system, user, schema: PROOFREAD_SCHEMA, signal });
  return result.fixes || [];
}

const partsText = (nums) => (nums.length === 1 ? `Part ${nums[0]}` : `Parts ${nums.slice(0, -1).join(', ')} and ${nums.at(-1)}`);

// priorityTerms: always shown. glossary: large list, filtered per chunk.
// Returns { suggestions, warning, checked }: `checked` lists the line ids of the parts that were read;
// a chunk that fails twice is skipped with a readable warning;
// only when every chunk fails does the whole run fail.
export async function proofread(cues, { proofreader, key, model, context, priorityTerms = [], glossary = [], tracks = [], threshold, signal, onProgress }) {
  const system = proofreadPrompt(context, priorityTerms.slice(0, 300));
  const pickTerms = glossary.length ? termPicker(glossary) : null;
  const chunks = proofreadChunks(cues, tracks);

  const byId = new Map(cues.map((c) => [c.id, c]));
  const out = [];
  const seen = new Set();
  const failures = [];
  const checked = [];
  let done = 0;
  const queue = chunks.map((chunk, i) => ({ chunk, n: i + 1 }));
  const runOnce = (chunk) => proofreadChunk(chunk, { proofreader, key, model, system, pickTerms, threshold, signal });
  const worker = async () => {
    while (queue.length) {
      signal?.throwIfAborted();
      const { chunk, n } = queue.shift();
      let fixes;
      try {
        fixes = await runOnce(chunk).catch((err) => {
          if (signal?.aborted) throw err;
          return runOnce(chunk); // one retry: these are usually timeouts or rate limits
        });
      } catch (err) {
        if (signal?.aborted) throw signal.reason ?? err;
        failures.push({ n, err });
        onProgress?.(++done / chunks.length);
        continue;
      }
      const ids = new Set(chunk.lines.map((c) => c.id)); // fixes for context lines are ignored
      checked.push(...ids);
      for (const f of fixes) {
        const id = f.id?.trim();
        const cue = ids.has(id) ? byId.get(id) : null;
        const from = stripEdges(unmark(f.from));
        const to = unmark(f.to).trim();
        if (!cue || !from || !to || norm(from) === norm(to) || !containsPhrase(cue.text, from)) continue;
        const occurrence = occurrenceFor(cue, from);
        const k = `${cue.id}|${norm(from)}|${norm(to)}`;
        if (occurrence < 0 || seen.has(k)) continue;
        seen.add(k);
        out.push({ cueId: cue.id, from, to: stripEdges(to) || to, occurrence, source: 'ai', sourceLabel: 'AI', reason: f.reason || '' });
      }
      onProgress?.(++done / chunks.length);
    }
  };
  const results = await Promise.allSettled([worker(), worker(), worker()]);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  if (failures.length && failures.length === chunks.length) throw failures[0].err;
  failures.sort((a, b) => a.n - b.n);
  const warning = failures.length
    ? `${partsText(failures.map((f) => f.n))} of ${chunks.length} couldn't be checked: ${String(failures[0].err?.message || 'unknown error').replace(/[.\s]+$/, '')}. Run again to retry.`
    : null;
  return { suggestions: out, warning, checked };
}

// ---------------------------------------------------------------- Jev verifier (optional)

// Asks TypeSafe Jev to pick between the original and the suggested wording.
// Returns the probability that the suggestion is right, or null on failure.
export async function verifyWithJev(items, { key, context, signal }) {
  const results = new Map();
  for (let i = 0; i < items.length; i += 20) {
    const batch = items.slice(i, i + 20);
    const questions = {};
    const state = batch
      .map((s, n) => `[${n}] ${s.surrounding}`)
      .join('\n');
    batch.forEach((s, n) => {
      questions[`q${n}`] = {
        type: 'choice',
        instructions: `In line [${n}] of this speech transcript, which wording is what the speaker most likely actually said?`,
        criteria: {
          original: `"${s.from}" (as transcribed)`,
          suggestion: `"${s.to}"`,
        },
      };
    });
    try {
      const data = await request('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'jev-latest', state: `${context ? `Video: ${context}\n` : ''}${state}`, questions }),
        signal,
      });
      batch.forEach((s, n) => results.set(s.id, data.answers?.[`q${n}`]?.probabilities?.suggestion ?? null));
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      if (err.status === 401) throw new Error('TypeSafe key was rejected. Check it in Settings.');
      batch.forEach((s) => results.set(s.id, null));
    }
  }
  return results;
}

// ---------------------------------------------------------------- orchestration

const isLine = s => s.kind === 'insert-line';
const lineTaken = (cues, s) => cues.some(c => c.track === s.track && c.end > s.start && c.start < s.end);
const suggestionKey = s => (isLine(s) ? `line|${s.track}|${Number(s.start).toFixed(2)}|${norm(s.text || '')}` : `${s.cueId}|${norm(s.from)}|${norm(s.to)}|${s.occurrence ?? 0}`);

// scope (optional): line ids this run actually checked; open suggestions of the source elsewhere are kept.
export function mergeSuggestions(jobId, fresh, source, snapshot, scope = null) {
  const byId = new Map(snapshot.map(c => [c.id, c]));
  return updateTranscript(jobId, state => {
    const current = new Map(state.cues.map(c => [c.id, c]));
    // What the app learned outranks a plain glossary match for the same words.
    const replaces = source === 'learned' ? new Set(fresh.map(suggestionKey)) : null;
    const existing = state.suggestions.filter(s => (s.source !== source || s.status !== 'open' || (scope && !scope.has(s.cueId)))
      && !(replaces && s.status === 'open' && ['glossary','people'].includes(s.source) && replaces.has(suggestionKey(s))));
    // An accepted fix already changed that spot; a remaining match in the line is a new one.
    const seen = new Set(existing.filter(s => s.status !== 'accepted' || isLine(s)).map(suggestionKey));
    for (let s of fresh) {
      if (isLine(s)) {
        if (lineTaken(state.cues, s)) continue;
      } else {
        const cue = current.get(s.cueId), old = byId.get(s.cueId);
        if (!cue || !old || cue.text !== old.text || cue.start !== old.start || cue.end !== old.end) continue;
        s = { ...s, occurrence: s.occurrence ?? 0, cueText: cue.text };
        if (!suggestionRange(cue, s)) continue; // gone, or the user set those words by hand
      }
      const key = suggestionKey(s);
      if (seen.has(key)) continue;
      seen.add(key);
      existing.push({ ...s, id: `s-${crypto.randomUUID()}`, verified: null, status: 'open' });
    }
    state.suggestions = existing;
  }).state.suggestions;
}

async function maybeVerify(job, project, settings, signal) {
  const key = settings.keys.typesafe;
  if (!key) return;
  const cues = new Map(readCues(job.id).map(c => [c.id, c]));
  const sorted = [...cues.values()].sort((a,b) => a.start-b.start);
  const todo = readSuggestions(job.id).filter(s => s.status === 'open' && s.verified == null && cues.has(s.cueId));
  if (!todo.length) return;
  const items = todo.map(s => {
    // Neighbouring lines from the same speaker's track, not whoever talks next on another mic.
    const cue = cues.get(s.cueId), own = sorted.filter(c => c.track === cue.track);
    const idx = own.findIndex(c => c.id === s.cueId);
    return { ...s, surrounding: own.slice(Math.max(0,idx-1),idx+2).map(c => c.text.replace(/\n/g,' ')).join(' / ') };
  });
  const scores = await verifyWithJev(items, { key, context: project?.context, signal });
  signal.throwIfAborted();
  updateTranscript(job.id, state => {
    for (const s of state.suggestions) if (s.status === 'open' && scores.has(s.id)) s.verified = scores.get(s.id);
  });
}

const checks = new Map();
export const activeChecks = () => checks.size;
export const isChecking = id => [...checks.keys()].some(key => key.startsWith(`${id}:`));
export async function cancelChecks(id) {
  const work = [...checks.entries()].filter(([key]) => key.startsWith(`${id}:`)).map(([,value]) => value);
  for (const task of work) task.controller.abort(new Error('Check cancelled'));
  await Promise.all(work.map(task => task.promise));
}
function runStep(jobId, field, fn) {
  const key = `${jobId}:${field}`;
  if (checks.has(key)) return checks.get(key).promise;
  const job = store.getJob(jobId);
  if (!job || isDeleting(jobId)) return Promise.resolve();
  const controller = new AbortController(), signal = controller.signal;
  job[field] = { ...job[field], status: 'running', error: null, progress: 0 };
  store.saveJob(job);
  const promise = Promise.resolve().then(async () => {
    try {
      signal.throwIfAborted();
      const result = await fn(job, p => {
        const j = store.getJob(jobId);
        if (j && !signal.aborted && !isDeleting(jobId)) { j[field] = { ...j[field], progress: p }; store.saveJob(j); }
      }, signal);
      signal.throwIfAborted();
      const j = store.getJob(jobId);
      if (j && !isDeleting(jobId)) { j[field] = { ...j[field], ...result, status: 'done', finishedAt: new Date().toISOString() }; store.saveJob(j); }
    } catch (err) {
      const j = store.getJob(jobId);
      if (j && !isDeleting(jobId)) { j[field] = { ...j[field], status: signal.aborted ? 'cancelled' : 'error', error: err.message }; store.saveJob(j); }
    } finally { checks.delete(key); }
  });
  checks.set(key, { controller, promise });
  return promise;
}
export function startProofread(jobId) {
  return runStep(jobId, 'proofread', async (job, onProgress, signal) => {
    const settings = store.getSettings(), proofreader = pickProofreader(settings);
    if (!proofreader) throw new Error('AI proofread needs a Claude, OpenAI or xAI key. Add one in Settings.');
    const model = modelFor(proofreader, settings);
    const project = store.getProject(job.projectId), snapshot = readCues(job.id), people = peopleContext();
    const context = [project?.context, people && `People often in these videos: ${people}`].filter(Boolean).join('\n');
    const tracks = job.tracks.map(t => ({ ...t, mediaName: store.getMedia(t.mediaId)?.displayName }));
    const { suggestions: found, warning, checked } = await proofread(snapshot, {
      proofreader, key: settings.keys[proofreader.keyName], model, context,
      priorityTerms: resolveKeyterms(job.options,settings).split(', ').filter(Boolean),
      glossary: resolveGlossary(job.options,settings), tracks, threshold: settings.confidenceThreshold, onProgress, signal,
    });
    signal.throwIfAborted();
    const merged = mergeSuggestions(job.id, found, 'ai', snapshot, new Set(checked));
    await maybeVerify(job,project,settings,signal);
    return { count: merged.filter(s => s.source === 'ai' && s.status === 'open').length, by: `${proofreader.name} · ${model}`, warning };
  });
}
export function runGlossaryCheck(jobId) {
  return runStep(jobId, 'glossary', async (job,onProgress,signal) => {
    const settings = store.getSettings(), terms = resolveGlossary(job.options,settings), snapshot = readCues(job.id);
    const found = glossaryCheck(snapshot,terms).map(f => ({ ...f, source: 'glossary', sourceLabel: 'Glossary' }));
    mergeSuggestions(job.id,found,'glossary',snapshot);
    await maybeVerify(job,store.getProject(job.projectId),settings,signal);
    return { count: found.length, terms: terms.length };
  });
}
// Free and instant: learned fixes and the people list.
export function runMemoryCheck(jobId) {
  return runStep(jobId, 'memory', async (job,onProgress,signal) => {
    const snapshot = readCues(job.id), found = memoryCheck(snapshot, getMemory());
    for (const source of ['learned','people']) mergeSuggestions(job.id, found.filter(f => f.source === source), source, snapshot);
    await maybeVerify(job,store.getProject(job.projectId),store.getSettings(),signal);
    return { count: found.length };
  });
}
export function applyCompare(jobId,otherJobId) {
  return runStep(jobId,'compare',async (job,onProgress,signal) => {
    const other = store.getJob(otherJobId);
    if (!other) throw new Error('Comparison transcript was deleted.');
    const wordsByTrack = {}, snapshot = readCues(job.id);
    job.tracks.forEach((t,pos) => {
      const otherPos = other.tracks.findIndex(o => o.mediaId === t.mediaId && o.index === t.index);
      if (otherPos >= 0) wordsByTrack[pos] = readWords(other.id,otherPos) || [];
    });
    const label = providers[other.provider]?.name || other.provider;
    const found = compareWords(snapshot,wordsByTrack,label);
    mergeSuggestions(job.id,found,'compare',snapshot);
    await maybeVerify(job,store.getProject(job.projectId),store.getSettings(),signal);
    return { count: found.length, jobId: other.id, provider: other.provider };
  });
}
const fixGroup = s => [s.from,s.to].map(v => v.trim().replace(/\s+/g,' ').toLowerCase()).join('|');
export function reconcileSuggestions(state) {
  const cues = new Map(state.cues.map(c => [c.id,c]));
  for (const s of state.suggestions) {
    // An ignored flag keeps its identity too: it follows its word, so a fix elsewhere in the line
    // does not turn it into a "new" flag on the word that is left.
    if (s.status === 'dismissed' && !isLine(s) && cues.has(s.cueId)) { rebaseSuggestion(s, cues.get(s.cueId)); continue; }
    if (s.status !== 'open') continue;
    // A word suggestion follows its own words through edits elsewhere in the line; if those words were
    // changed, locked or removed it goes stale (never re-pointed at another match).
    if (isLine(s) ? lineTaken(state.cues, s) : (!cues.has(s.cueId) || !rebaseSuggestion(s, cues.get(s.cueId)))) s.status = 'stale';
  }
}
const clock = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
// Length of a job track's audio in seconds (0 when unknown).
const trackDuration = (job, pos) => {
  const track = job?.tracks?.[pos];
  try {
    const media = track && store.getMedia(track.mediaId);
    return media?.tracks?.find(t => t.index === track.index)?.duration || media?.duration || 0;
  } catch { return 0; } // media removed or id unusable
};
// "Possibly missed" line: adds it as new line(s) on that track, in time order, laid out by the same
// rules as every other subtitle (line length, speakers, duration). One undo step removes them all.
function acceptLine(jobId, s, to) {
  const text = to?.trim() || s.text;
  const job = store.getJob(jobId);
  const { state, result: created } = updateTranscript(jobId, state => {
    const x = state.suggestions.find(v => v.id === s.id && v.status === 'open');
    if (!x) throw new Error('This suggestion is no longer available.');
    if (lineTaken(state.cues, x)) throw new Error('There is already a line at this time. The suggestion no longer applies.');
    let words = (x.words || []).filter(w => w.text?.trim());
    const spokenEnd = Math.max(x.end, ...words.map(w => w.end));
    // Text the user changed (or a suggestion without timed words): spread the words over the heard span.
    // Only capitalization/punctuation changed (e.g. the suggestion's capital first letter): keep the heard timings and speakers.
    const tokens0 = text.split(/\s+/).filter(Boolean);
    if (words.length && tokens0.length === words.length && norm(joinWords(words)) === norm(text)) words = words.map((w, i) => ({ ...w, text: tokens0[i] }));
    else if (!words.length || joinWords(words) !== text.replace(/\s+/g, ' ')) {
      const tokens = text.split(/\s+/).filter(Boolean), step = (spokenEnd - x.start) / Math.max(tokens.length, 1);
      words = tokens.map((t, i) => ({ text: t, start: x.start + i * step, end: x.start + (i + 1) * step, confidence: null, speaker: words[0]?.speaker ?? null }));
    }
    const built = buildCues(words, { ...store.getSettings().cue, mediaDuration: trackDuration(job, x.track) }, x.track);
    if (!built.length) throw new Error('There is no text to add.');
    const nextStart = Math.min(Infinity, ...state.cues.filter(c => c.track === x.track && c.start >= x.end).map(c => c.start));
    const made = built.map(c => {
      const end = Math.max(...c.words.map(w => w.end));
      const cue = { ...c, id: `${x.track}-add${crypto.randomUUID().slice(0, 8)}`, end: Math.max(Math.min(c.end, nextStart), end), edited: true, locked: [] };
      lockPhrase(cue, cue.text);
      return cue;
    });
    for (const cue of made) {
      const at = state.cues.findIndex(c => c.start > cue.start);
      state.cues.splice(at < 0 ? state.cues.length : at, 0, cue);
    }
    x.status = 'accepted';
    reconcileSuggestions(state);
    return made;
  }, `Add missed line at ${clock(s.start)}`);
  return { cues: created, suggestions: state.suggestions };
}
export function acceptSuggestion(jobId,suggestionId,{all=false,to}={}) {
  const s = readSuggestions(jobId).find(x => x.id === suggestionId && x.status === 'open');
  if (!s) throw new Error('This suggestion is no longer available.');
  if (to != null && typeof to !== 'string') throw new Error('The replacement must be text.');
  if (isLine(s)) return acceptLine(jobId, s, to);
  const replacement = to?.trim() || s.to;
  const { state, result: changed } = updateTranscript(jobId,state => {
    const cues = new Map(state.cues.map(c => [c.id, c]));
    const matching = state.suggestions.filter(x => x.status === 'open' && !isLine(x) && (all ? fixGroup(x) === fixGroup(s) : x.id === s.id));
    const targets = [], accepted = [];
    for (const cue of new Set(matching.map(x => cues.get(x.cueId)).filter(Boolean))) {
      // Bring each suggestion up to the line as it is now; one whose words changed is skipped.
      const live = matching.filter(x => x.cueId === cue.id && rebaseSuggestion(x, cue));
      // A single Fix changes only its own match. Fix all changes every match the user has not locked.
      const ranges = all ? phraseRanges(cue.text, s.from).filter(([a, b]) => !overlapsLocked(cue, a, b)) : live.filter(x => x.id === s.id).map(x => suggestionRange(cue, x));
      if (!ranges.length) continue;
      const mine = live.filter(x => { const r = suggestionRange(cue, x); return r && ranges.some(([a]) => a === r[0]); });
      accepted.push(...mine);
      // We know exactly which ranges change, so the cue's other flags (open and ignored) move through the edit.
      const others = state.suggestions.filter(x => x.cueId === cue.id && !isLine(x) && (x.status === 'open' || x.status === 'dismissed') && !mine.includes(x));
      replaceKnownRanges(cue, ranges, replacement, others);
      // A line edited by an older version (no lock list yet): lock all of it, we cannot tell what was typed.
      const legacy = cue.edited && !Array.isArray(cue.locked);
      cue.edited = true;
      if (!Array.isArray(cue.locked)) cue.locked = [];
      lockPhrase(cue, legacy ? cue.text : replacement);
      targets.push(cue);
    }
    if (!targets.length) throw new Error('This line has changed. The suggestion no longer applies.');
    for (const x of accepted) x.status = 'accepted';
    reconcileSuggestions(state);
    return targets;
  }, `${all ? 'Fix matching lines' : 'Fix'}: "${s.from}" → "${replacement}"`);
  // Extra words the other service heard ("get more stone") are not a mishearing worth learning.
  if (s.kind !== 'insert') {
    recordFix(s.from, replacement, { fixed: changed.length });
    if (replacement !== s.to) recordFix(s.from, s.to, { ignored: 1 });
  }
  return { cues: changed, suggestions: state.suggestions };
}
export function dismissSuggestion(jobId,suggestionId) {
  const { state, result: s } = updateTranscript(jobId,state => {
    const s = state.suggestions.find(x => x.id === suggestionId);
    if (s?.status !== 'open') return null;
    s.status = 'dismissed';
    return s;
  }, 'Ignore suggestion');
  if (s && !s.kind) recordFix(s.from, s.to, { ignored: 1 });
  return state.suggestions;
}
