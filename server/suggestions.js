// Finding likely mis-transcriptions ("Couples Stone" -> "Cobblestone").
//
// Candidates come from two finders:
//   - AI proofread: a Grok text model reads the transcript with the project context.
//   - Compare: a second provider's words are aligned against this job's words.
// An optional verifier (TypeSafe Jev) then scores each candidate with a calibrated probability.
//
// Suggestion: { id, cueId, from, to, source: 'ai'|'compare', sourceLabel, reason,
//               verified: number|null, status: 'open'|'accepted'|'dismissed' }
import { providers } from './providers/index.js';
import { request } from './providers/http.js';
import { pickProofreader } from './proofreaders.js';
import * as store from './store.js';
import { glossaryCheck, termPicker } from './glossary.js';
import { readCues, readSuggestions, readWords, resolveGlossary, resolveKeyterms, writeCues, writeSuggestions } from './jobs.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches `from` in cue text as whole words, tolerating line breaks and case.
export function phraseRegex(from, flags = 'iu') {
  const tokens = from.trim().split(/\s+/).map(escapeRe);
  return new RegExp(`(?<![\\p{L}\\p{N}])${tokens.join('\\s+')}(?![\\p{L}\\p{N}])`, flags);
}

export function replacePhrase(text, from, to, all = false) {
  return text.replace(phraseRegex(from, all ? 'giu' : 'iu'), to);
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

// For each cue, align its words with the other provider's words in the same time span
// and report stretches where the two heard different words.
export function compareWords(cues, otherWordsByTrack, otherLabel) {
  const out = [];
  for (const cue of cues) {
    if (cue.edited || !cue.words?.length) continue;
    const other = (otherWordsByTrack[cue.track] || []).filter((w) => w.end > cue.start - 0.4 && w.start < cue.end + 0.4);
    if (!other.length) continue;
    const a = cue.words.map((w) => norm(w.text));
    const b = other.map((w) => norm(w.text));
    const pairs = [[-1, -1], ...lcsPairs(a, b), [a.length, b.length]];

    for (let k = 0; k < pairs.length - 1; k++) {
      const [ai, bi] = pairs[k];
      const [aj, bj] = pairs[k + 1];
      const aGap = cue.words.slice(ai + 1, aj);
      let bGap = other.slice(bi + 1, bj);
      if (!aGap.length || !bGap.length) continue; // pure insertions/deletions are mostly fillers
      // At the cue edges, only keep the other provider's words that overlap in time.
      const edge = k === 0 || k === pairs.length - 2;
      if (edge) {
        const s = aGap[0].start - 0.25;
        const e = aGap[aGap.length - 1].end + 0.25;
        bGap = bGap.filter((w) => w.end > s && w.start < e);
        if (!bGap.length) continue;
      }
      const from = stripEdges(aGap.map((w) => w.text).join(' '));
      let to = stripEdges(bGap.map((w) => w.text).join(' '));
      if (!from || !to) continue;
      // "cobble stone" vs "cobblestone", "OK" vs "okay"-level noise is not worth a flag.
      if (norm(from.replace(/\s/g, '')) === norm(to.replace(/\s/g, ''))) continue;
      if (/^\p{Lu}/u.test(from) && /^\p{Ll}/u.test(to)) to = to[0].toUpperCase() + to.slice(1);
      if (!containsPhrase(cue.text, from)) continue;
      out.push({ cueId: cue.id, from, to, source: 'compare', sourceLabel: otherLabel, reason: `${otherLabel} heard "${to}"` });
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
    context ? `What this video is: ${context}` : '',
    priorityTerms.length ? `Key names in this video: ${priorityTerms.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function proofreadChunk(lines, { proofreader, key, model, system, pickTerms, signal }) {
  const transcript = lines.map((c) => `${c.id} | ${c.text.replace(/\n/g, ' ')}`).join('\n');
  // Only the glossary names that plausibly relate to these lines, so huge modpack lists stay affordable.
  const related = pickTerms ? pickTerms(transcript) : [];
  const user = related.length ? `Other names from this game/modpack that may be relevant: ${related.join(', ')}\n\n${transcript}` : transcript;
  const result = await proofreader.run({ key, model, system, user, schema: PROOFREAD_SCHEMA, signal });
  return result.fixes || [];
}

// priorityTerms: always shown. glossary: large list, filtered per chunk.
export async function proofread(cues, { proofreader, key, model, context, priorityTerms = [], glossary = [], signal, onProgress }) {
  const system = proofreadPrompt(context, priorityTerms.slice(0, 300));
  const pickTerms = glossary.length ? termPicker(glossary) : null;
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const chunks = [];
  for (let i = 0; i < sorted.length; i += 150) chunks.push(sorted.slice(i, i + 150));

  const byId = new Map(cues.map((c) => [c.id, c]));
  const out = [];
  let done = 0;
  const queue = [...chunks];
  const worker = async () => {
    while (queue.length) {
      const chunk = queue.shift();
      const fixes = await proofreadChunk(chunk, { proofreader, key, model, system, pickTerms, signal });
      for (const f of fixes) {
        const cue = byId.get(f.id?.trim());
        const from = stripEdges(f.from || '');
        const to = (f.to || '').trim();
        if (!cue || !from || !to || norm(from) === norm(to) || !containsPhrase(cue.text, from)) continue;
        out.push({ cueId: cue.id, from, to: stripEdges(to) || to, source: 'ai', sourceLabel: 'AI', reason: f.reason || '' });
      }
      onProgress?.(++done / chunks.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
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
      if (err.status === 401) throw new Error('TypeSafe key was rejected. Check it in Settings.');
      batch.forEach((s) => results.set(s.id, null));
    }
  }
  return results;
}

// ---------------------------------------------------------------- orchestration

function mergeSuggestions(jobId, fresh, source) {
  const existing = readSuggestions(jobId).filter((s) => s.source !== source || s.status !== 'open');
  const seen = new Set(existing.map((s) => `${s.cueId}|${norm(s.from)}|${norm(s.to)}`));
  let n = existing.reduce((max, s) => Math.max(max, Number(s.id.slice(2)) || 0), 0);
  for (const s of fresh) {
    const k = `${s.cueId}|${norm(s.from)}|${norm(s.to)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    existing.push({ ...s, id: `s-${++n}`, verified: null, status: 'open' });
  }
  writeSuggestions(jobId, existing);
  return existing;
}

async function maybeVerify(job, project, settings) {
  const key = settings.keys.typesafe;
  if (!key) return;
  const cues = new Map(readCues(job.id).map((c) => [c.id, c]));
  const sorted = [...cues.values()].sort((a, b) => a.start - b.start);
  const all = readSuggestions(job.id);
  const todo = all.filter((s) => s.status === 'open' && s.verified == null && cues.has(s.cueId));
  if (!todo.length) return;
  const items = todo.map((s) => {
    const idx = sorted.findIndex((c) => c.id === s.cueId);
    const around = sorted.slice(Math.max(0, idx - 1), idx + 2).map((c) => c.text.replace(/\n/g, ' ')).join(' / ');
    return { id: s.id, from: s.from, to: s.to, surrounding: around };
  });
  const scores = await verifyWithJev(items, { key, context: project?.context });
  for (const s of all) if (scores.has(s.id)) s.verified = scores.get(s.id);
  writeSuggestions(job.id, all);
}

async function runStep(jobId, field, fn) {
  const job = store.getJob(jobId);
  job[field] = { ...job[field], status: 'running', error: null, progress: 0 };
  store.saveJob(job);
  try {
    const result = await fn(job, (p) => {
      const j = store.getJob(jobId);
      if (j) {
        j[field].progress = p;
        store.saveJob(j);
      }
    });
    const j = store.getJob(jobId);
    if (j) {
      j[field] = { ...j[field], ...result, status: 'done', finishedAt: new Date().toISOString() };
      store.saveJob(j);
    }
  } catch (err) {
    const j = store.getJob(jobId);
    if (j) {
      j[field] = { ...j[field], status: 'error', error: err.message };
      store.saveJob(j);
    }
  }
}

export function startProofread(jobId) {
  return runStep(jobId, 'proofread', async (job, onProgress) => {
    const settings = store.getSettings();
    const proofreader = pickProofreader(settings);
    if (!proofreader) throw new Error('AI proofread needs a Claude, OpenAI or xAI key. Add one in Settings.');
    const model = settings.proofread.models?.[proofreader.id] || proofreader.defaultModel;
    const project = store.getProject(job.projectId);
    const found = await proofread(readCues(job.id), {
      proofreader,
      key: settings.keys[proofreader.keyName],
      model,
      context: project?.context,
      priorityTerms: resolveKeyterms(job.options, settings).split(', ').filter(Boolean),
      glossary: resolveGlossary(job.options, settings),
      onProgress,
    });
    mergeSuggestions(job.id, found, 'ai');
    await maybeVerify(job, project, settings);
    return { count: found.length, by: `${proofreader.name} · ${model}` };
  });
}

// Free sound-alike check against the selected term lists' full glossaries.
export function runGlossaryCheck(jobId) {
  return runStep(jobId, 'glossary', async (job) => {
    const settings = store.getSettings();
    const terms = resolveGlossary(job.options, settings);
    if (!terms.length) return { count: 0, terms: 0 };
    const found = glossaryCheck(readCues(job.id), terms).map((f) => ({ ...f, source: 'glossary', sourceLabel: 'Glossary' }));
    mergeSuggestions(job.id, found, 'glossary');
    await maybeVerify(job, store.getProject(job.projectId), settings);
    return { count: found.length, terms: terms.length };
  });
}

// Cross-check `jobId` against the words of `otherJobId` (same tracks, other provider).
export function applyCompare(jobId, otherJobId) {
  return runStep(jobId, 'compare', async (job) => {
    const other = store.getJob(otherJobId);
    if (!other) throw new Error('Comparison transcript was deleted.');
    const wordsByTrack = {};
    job.tracks.forEach((t, pos) => {
      const otherPos = other.tracks.findIndex((o) => o.mediaId === t.mediaId && o.index === t.index);
      if (otherPos >= 0) wordsByTrack[pos] = readWords(other.id, otherPos) || [];
    });
    const label = providers[other.provider]?.name || other.provider;
    const found = compareWords(readCues(job.id), wordsByTrack, label);
    mergeSuggestions(job.id, found, 'compare');
    const settings = store.getSettings();
    await maybeVerify(job, store.getProject(job.projectId), settings);
    return { count: found.length, jobId: other.id, provider: other.provider };
  });
}

// Accept a suggestion on its own cue, or everywhere the same phrase occurs.
export function acceptSuggestion(jobId, suggestionId, { all = false, to } = {}) {
  const suggestions = readSuggestions(jobId);
  const s = suggestions.find((x) => x.id === suggestionId);
  if (!s) throw new Error('Suggestion not found');
  const replacement = to?.trim() || s.to;
  const cues = readCues(jobId);
  const changed = [];
  for (const cue of cues) {
    if (!(all || cue.id === s.cueId) || !containsPhrase(cue.text, s.from)) continue;
    cue.text = replacePhrase(cue.text, s.from, replacement, true);
    cue.edited = true;
    changed.push(cue);
  }
  writeCues(jobId, cues);
  for (const x of suggestions) {
    const sameFix = norm(x.from) === norm(s.from) && x.status === 'open';
    if (x.id === s.id || (all && sameFix)) x.status = 'accepted';
  }
  writeSuggestions(jobId, suggestions);
  return { cues: changed, suggestions };
}

export function dismissSuggestion(jobId, suggestionId) {
  const suggestions = readSuggestions(jobId);
  const s = suggestions.find((x) => x.id === suggestionId);
  if (s) s.status = 'dismissed';
  writeSuggestions(jobId, suggestions);
  return suggestions;
}
