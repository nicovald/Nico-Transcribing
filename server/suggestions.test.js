import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'transcriber-suggestions-'));
process.env.DATA_DIR = temp;
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const { compareWords, replacePhrase, acceptSuggestion, proofread, mergeSuggestions, reconcileSuggestions } = await import('./suggestions.js');
const store = await import('./store.js');
const { readTranscript, updateTranscript, undo } = await import('./transcript.js');

const w = (text, start, end) => ({ text, start, end, confidence: null, speaker: null });

test('replacePhrase matches whole words across line breaks, case-insensitively', () => {
  assert.equal(replacePhrase('Destroy Couples\nStone!', 'couples stone', 'Cobblestone'), 'Destroy Cobblestone!');
  assert.equal(replacePhrase('Couples Stoned', 'Couples Stone', 'Cobblestone'), 'Couples Stoned');
  assert.equal(replacePhrase('a fire break, fire break', 'fire break', 'fire brick', true), 'a fire brick, fire brick');
});

test('compareWords flags where the second provider heard different words', () => {
  const cue = {
    id: '0-0',
    track: 0,
    start: 0,
    end: 2,
    text: 'Destroy Couples Stone!',
    words: [w('Destroy', 0, 0.4), w('Couples', 0.5, 0.9), w('Stone!', 0.9, 1.4)],
  };
  const other = [w('Destroy', 0, 0.4), w('cobblestone!', 0.5, 1.4)];
  const found = compareWords([cue], { 0: other }, 'Deepgram');
  assert.equal(found.length, 1);
  assert.equal(found[0].from, 'Couples Stone');
  assert.equal(found[0].to, 'Cobblestone');
});

test('compareWords ignores spacing-only and punctuation-only differences', () => {
  const cue = {
    id: '0-0', track: 0, start: 0, end: 2, text: 'Get the cobble stone, okay.',
    words: [w('Get', 0, 0.2), w('the', 0.2, 0.3), w('cobble', 0.3, 0.6), w('stone,', 0.6, 0.9), w('okay.', 1, 1.3)],
  };
  const other = [w('Get', 0, 0.2), w('the', 0.2, 0.3), w('cobblestone', 0.3, 0.9), w('okay', 1, 1.3)];
  assert.deepEqual(compareWords([cue], { 0: other }, 'X'), []);
});

test('compareWords ignores neighbouring words that belong to other cues', () => {
  const cue = { id: '0-1', track: 0, start: 2, end: 3, text: 'Hello there.', words: [w('Hello', 2, 2.4), w('there.', 2.4, 3)] };
  const other = [w('previous', 1.7, 1.95), w('Hello', 2, 2.4), w('there', 2.4, 3), w('next', 3.1, 3.3)];
  assert.deepEqual(compareWords([cue], { 0: other }, 'X'), []);
});

test('compareWords suggests words only the other service heard inside a line', () => {
  const cue = { id: '0-0', track: 0, start: 0, end: 1, text: 'Get stone.', words: [w('Get', 0, 0.3), w('stone.', 0.6, 1)] };
  const other = [w('Get', 0, 0.3), w('more', 0.3, 0.55), w('stone.', 0.6, 1)];
  const found = compareWords([cue], { 0: other }, 'Deepgram');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'insert');
  assert.equal(found[0].from, 'Get stone');
  assert.equal(found[0].to, 'Get more stone');
  // Fillers the other service kept are not worth a flag.
  const um = [w('Get', 0, 0.3), w('um', 0.3, 0.55), w('stone.', 0.6, 1)];
  assert.deepEqual(compareWords([cue], { 0: um }, 'X'), []);
});

test('compareWords flags lines the other service heard where there is no subtitle', () => {
  const cues = [
    { id: '0-0', track: 0, start: 0, end: 1, text: 'Hello there.', words: [w('Hello', 0, 0.4), w('there.', 0.4, 1)] },
    { id: '0-1', track: 0, start: 10, end: 11, text: 'Bye.', words: [w('Bye.', 10, 11)] },
  ];
  const other = [w('Hello', 0, 0.4), w('there', 0.4, 1), w('um', 4, 4.2), w('watch', 4.3, 4.6), w('out', 4.6, 4.9), w('behind', 5, 5.3), w('you!', 5.3, 5.6), w('uh', 7, 7.2), w('Bye.', 10, 11)];
  const found = compareWords(cues, { 0: other }, 'Deepgram');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'insert-line');
  assert.equal(found[0].track, 0);
  assert.equal(found[0].text, 'Um watch out behind you!');
  assert.equal(found[0].start, 4);
  assert.equal(found[0].end, 5.6);
});

test('compareWords skips words the user locked on an edited line', () => {
  const cue = { id: '0-0', track: 0, start: 0, end: 2, text: 'Destroy Couples Stone!', edited: true, locked: ['Couples Stone'],
    words: [w('Destroy', 0, 0.4), w('Couples', 0.5, 0.9), w('Stone!', 0.9, 1.4)] };
  const other = [w('Destroy', 0, 0.4), w('cobblestone!', 0.5, 1.4)];
  assert.deepEqual(compareWords([cue], { 0: other }, 'X'), []);
  assert.equal(compareWords([{ ...cue, locked: [] }], { 0: other }, 'X').length, 1);
});

const seedJob = (cues, suggestions) => {
  const job = { id: crypto.randomUUID(), projectId: 'p', provider: 'grok', status: 'done', tracks: [{ mediaId: 'm', index: 0, label: 'Mic', status: 'done' }] };
  store.saveJob(job);
  updateTranscript(job.id, (state) => { state.cues = structuredClone(cues); state.suggestions = structuredClone(suggestions); });
  return job;
};

test('Fix changes only the flagged occurrence; Fix all changes every one', () => {
  const cue = { id: '0-0', track: 0, start: 0, end: 2, text: 'Craner called Craner', words: [], edited: false };
  const sug = (id, occurrence) => ({ id, cueId: '0-0', from: 'Craner', to: 'Crainer', occurrence, source: 'compare', status: 'open' });
  let job = seedJob([cue], [sug('a', 1)]);
  acceptSuggestion(job.id, 'a');
  const fixed = readTranscript(job.id).cues[0];
  assert.equal(fixed.text, 'Craner called Crainer');
  assert.deepEqual(fixed.locked, ['Crainer']);
  job = seedJob([cue], [sug('b')]);
  acceptSuggestion(job.id, 'b');
  assert.equal(readTranscript(job.id).cues[0].text, 'Crainer called Craner');
  job = seedJob([cue], [sug('c', 0)]);
  acceptSuggestion(job.id, 'c', { all: true });
  assert.equal(readTranscript(job.id).cues[0].text, 'Crainer called Crainer');
});

test('adding a missed line inserts it in time order and undo removes it', () => {
  const cues = [
    { id: '0-0', track: 0, start: 0, end: 1, text: 'Hello there.', words: [] },
    { id: '0-1', track: 0, start: 10, end: 11, text: 'Bye.', words: [] },
  ];
  const line = { id: 'l', kind: 'insert-line', cueId: null, track: 0, start: 4, end: 5.6, text: 'Watch out behind you!', from: '', to: 'Watch out behind you!', source: 'compare', status: 'open' };
  const job = seedJob(cues, [line]);
  const r = acceptSuggestion(job.id, 'l');
  assert.equal(r.cues.length, 1);
  const state = readTranscript(job.id);
  assert.deepEqual(state.cues.map((c) => c.text), ['Hello there.', 'Watch out behind you!', 'Bye.']);
  assert.equal(state.suggestions[0].status, 'accepted');
  undo(job.id);
  const back = readTranscript(job.id);
  assert.deepEqual(back.cues.map((c) => c.text), ['Hello there.', 'Bye.']);
  assert.equal(back.suggestions[0].status, 'open');
});

test('undoing an added missed line brings back the wording the user typed', () => {
  const cues = [{ id: '0-0', track: 0, start: 0, end: 1, text: 'Hello there.', words: [] }, { id: '0-1', track: 0, start: 10, end: 11, text: 'Bye.', words: [] }];
  const line = { id: 'l', kind: 'insert-line', cueId: null, track: 0, start: 4, end: 5.6, text: 'Watch out behind you', from: '', to: 'Watch out behind you', source: 'compare', status: 'open' };
  const job = seedJob(cues, [line]);
  acceptSuggestion(job.id, 'l', { to: 'Watch out behind us' });
  undo(job.id);
  const back = readTranscript(job.id).suggestions[0];
  assert.equal(back.status, 'open');
  assert.equal(back.draft, 'Watch out behind us');
  assert.equal(back.text, 'Watch out behind you');
});

test('proofread keeps the parts that worked when one part keeps failing', async () => {
  const text = (i) => (i === 5 ? 'More couples stone' : i === 200 ? 'Fire break here' : `Line ${i}`);
  const cues = Array.from({ length: 320 }, (_, i) => ({ id: `0-${i}`, track: 0, start: i, end: i + 0.9, text: text(i), words: [] }));
  let calls = 0;
  const proofreader = {
    run: async ({ user }) => {
      calls++;
      if (/Lines to check:\n0-300 \|/.test(user)) throw new Error('The AI service timed out.');
      const fixes = [];
      if (user.includes('0-5 | More couples stone')) fixes.push({ id: '0-5', from: 'couples stone', to: 'Cobblestone', reason: 'block' });
      if (user.includes('0-200 | Fire break')) fixes.push({ id: '0-200', from: 'Fire break', to: 'Fire brick', reason: 'block' });
      return { fixes };
    },
  };
  const { suggestions, warning } = await proofread(cues, { proofreader, key: 'k', model: 'm', tracks: [{ mediaId: 'm', label: 'Mic' }] });
  assert.deepEqual(suggestions.map((s) => s.to).sort(), ['Cobblestone', 'Fire brick']);
  assert.equal(calls, 4); // 3 parts, the failing one retried once
  assert.match(warning, /^Part 3 of 3 couldn.t be checked: The AI service timed out\./);
});

test('proofread marks unsure words, shows earlier lines as context and ignores fixes for them', async () => {
  const cues = Array.from({ length: 160 }, (_, i) => ({
    id: `0-${i}`, track: 0, start: i, end: i + 0.9, text: `Line ${i}`,
    words: [w('Line', i, i + 0.4), { ...w(String(i), i + 0.4, i + 0.9), confidence: i === 145 ? 0.2 : 0.95 }],
  }));
  const users = [];
  const proofreader = { run: async ({ user }) => { users.push(user); return { fixes: [{ id: '0-145', from: '[?145]', to: '146', reason: 'x' }] }; } };
  const { suggestions } = await proofread(cues, { proofreader, key: 'k', model: 'm', threshold: 0.6, tracks: [{ mediaId: 'm', label: 'Ian mic' }] });
  assert.ok(users.every((u) => u.startsWith('Track: Ian mic')));
  assert.ok(users.some((u) => u.includes('0-145 | Line [?145]')));
  assert.match(users.find((u) => u.includes('Context')), /Context \(do not fix these\):\n0-142 \|/);
  assert.equal(suggestions.length, 1); // from the first part only, not from the context copy
  assert.equal(suggestions[0].from, '145');
});

test('proofread groups lines by track instead of mixing speakers', async () => {
  const cues = [
    { id: '0-0', track: 0, start: 0, end: 1, text: 'Ian one', words: [] },
    { id: '1-0', track: 1, start: 0.5, end: 1.5, text: 'Ben one', words: [] },
    { id: '0-1', track: 0, start: 2, end: 3, text: 'Ian two', words: [] },
  ];
  const users = [];
  await proofread(cues, { proofreader: { run: async ({ user }) => { users.push(user); return { fixes: [] }; } }, key: 'k', model: 'm', tracks: [{ mediaId: 'm', label: 'Ian' }, { mediaId: 'm', label: 'Ben' }] });
  assert.deepEqual(users.sort(), ['Track: Ben\n\nLines to check:\n1-0 | Ben one', 'Track: Ian\n\nLines to check:\n0-0 | Ian one\n0-1 | Ian two']);
});

const craner = (id, extra = {}) => ({ id, track: 0, start: 0, end: 3, text: 'Craner called Craner', words: [w('Craner', 0, 1), w('called', 1, 2), w('Craner', 2, 3)], edited: false, ...extra });
const csug = (id, cueId, occurrence, extra = {}) => ({ id, cueId, from: 'Craner', to: 'Crainer', occurrence, source: 'compare', status: 'open', ...extra });

test('Fix all skips occurrences that overlap locked words and marks only the applied ones', () => {
  const a = craner('a', { edited: true, locked: ['Craner called'] });
  const b = craner('b');
  const job = seedJob([a, b], [csug('sa', 'a', 1), csug('sb', 'b', 0)]);
  acceptSuggestion(job.id, 'sb', { all: true });
  const state = readTranscript(job.id);
  assert.deepEqual(state.cues.map((c) => c.text), ['Craner called Crainer', 'Crainer called Crainer']);
  assert.deepEqual(state.suggestions.map((x) => x.status), ['accepted', 'accepted']);
  // A suggestion whose only match is locked is not applied, so it is not marked accepted.
  const locked = craner('l', { edited: true, locked: ['Craner called Craner'] });
  const j2 = seedJob([locked, b], [csug('sl', 'l', 0), csug('sb', 'b', 0)]);
  acceptSuggestion(j2.id, 'sb', { all: true });
  const s2 = readTranscript(j2.id);
  assert.equal(s2.cues[0].text, 'Craner called Craner');
  assert.notEqual(s2.suggestions.find((x) => x.id === 'sl').status, 'accepted');
});

test('compare aligns an edited line by its current words, not the stale raw ones', () => {
  const cue = craner('0-0', { text: 'Crainer called Craner', edited: true, locked: ['Crainer'] });
  const other = [w('Crainer', 0, 1), w('called', 1, 2), w('Crane', 2, 3)];
  const found = compareWords([cue], { 0: other }, 'X');
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].from, found[0].to, found[0].occurrence], ['Craner', 'Crane', 0]);
});

test('a suggestion never falls back to another match after the line is edited', () => {
  const cue = craner('0-0', { text: 'Craner met Craner' });
  const job = seedJob([cue], [csug('x', '0-0', 1, { cueText: 'Craner met Craner' })]);
  updateTranscript(job.id, (state) => { state.cues[0].text = 'Craner met Crane'; reconcileSuggestions(state); });
  assert.equal(readTranscript(job.id).suggestions[0].status, 'stale');
  assert.throws(() => acceptSuggestion(job.id, 'x'), /no longer available/);
  assert.equal(readTranscript(job.id).cues[0].text, 'Craner met Crane');
  // An edit elsewhere in the line moves the suggestion with its words instead.
  const j2 = seedJob([cue], [csug('y', '0-0', 1, { cueText: 'Craner met Craner' })]);
  updateTranscript(j2.id, (state) => { state.cues[0].text = 'Hey Craner met Craner'; reconcileSuggestions(state); });
  acceptSuggestion(j2.id, 'y');
  assert.equal(readTranscript(j2.id).cues[0].text, 'Hey Craner met Crainer');
});

test('overlapping speaker cues with identical comparison words produce no suggestions', () => {
  const cues = [
    { id: '0-0', track: 0, start: 0, end: 1, text: 'Go', words: [w('Go', 0, 1)] },
    { id: '0-1', track: 0, start: 0.5, end: 0.8, text: 'Run', words: [w('Run', 0.5, 0.8)] },
  ];
  assert.deepEqual(compareWords(cues, { 0: [w('Go', 0, 1), w('Run', 0.5, 0.8)] }, 'X'), []);
});

test('repeated occurrences stay separate suggestions and the second is rebased after the first Fix', () => {
  const cue = craner('0-0');
  const other = [w('Crainer', 0, 1), w('called', 1, 2), w('Crainer', 2, 3)];
  const found = compareWords([cue], { 0: other }, 'X');
  assert.deepEqual(found.map((f) => f.occurrence), [0, 1]);
  const job = seedJob([cue], []);
  mergeSuggestions(job.id, found, 'compare', [cue]);
  const [first, second] = readTranscript(job.id).suggestions;
  assert.notEqual(first.id, second.id);
  acceptSuggestion(job.id, first.id);
  const mid = readTranscript(job.id);
  assert.equal(mid.cues[0].text, 'Crainer called Craner');
  assert.equal(mid.suggestions[1].status, 'open');
  assert.equal(mid.suggestions[1].occurrence, 0);
  acceptSuggestion(job.id, second.id);
  assert.equal(readTranscript(job.id).cues[0].text, 'Crainer called Crainer');
});

test('a failed proofread part keeps its existing AI suggestions', async () => {
  const cues = [craner('0-1'), craner('0-2')];
  const job = seedJob(cues, [csug('keep', '0-2', 0, { source: 'ai', cueText: cues[1].text }), csug('old', '0-1', 0, { source: 'ai', cueText: cues[0].text })]);
  mergeSuggestions(job.id, [], 'ai', cues, new Set(['0-1']));
  const byId = Object.fromEntries(readTranscript(job.id).suggestions.map((x) => [x.id, x.status]));
  assert.equal(byId.keep, 'open');
  assert.equal(byId.old, undefined); // re-checked and no longer reported
  const { checked } = await proofread(cues, { proofreader: { run: async () => ({ fixes: [] }) }, key: 'k', model: 'm', tracks: [{ mediaId: 'm' }] });
  assert.deepEqual([...checked].sort(), ['0-1', '0-2']);
});

test('an accepted missed line goes through cue building, keeps the full word end and can make several cues', () => {
  const words = Array.from({ length: 14 }, (_, i) => w('cobblestone', i * 0.4, i * 0.4 + 0.3));
  const line = { id: 'l', kind: 'insert-line', cueId: null, track: 0, start: 0, end: 5.5, text: words.map((x) => x.text).join(' '), words, from: '', to: 'x', source: 'compare', status: 'open' };
  const job = seedJob([{ id: '0-0', track: 0, start: 20, end: 21, text: 'Bye.', words: [] }], [line]);
  const r = acceptSuggestion(job.id, 'l');
  assert.ok(r.cues.length > 1);
  assert.ok(r.cues.every((c) => c.text.split('\n').every((l) => l.length <= 42)));
  assert.equal(new Set(r.cues.map((c) => c.id)).size, r.cues.length);
  undo(job.id);
  assert.equal(readTranscript(job.id).cues.length, 1);
  const bye = { id: '0-0', track: 0, start: 20, end: 21, text: 'Bye.', words: [w('Bye.', 20, 21)] };
  const found = compareWords([bye], { 0: [w('Long', 3, 5), w('short', 4, 4.1), w('Bye.', 20, 21)] }, 'X');
  assert.equal(found[0].end, 5);
});

test('deleting a clause with a repeated name makes the suggestion stale instead of moving to the other copy', () => {
  const cue = craner('0-0', { text: 'Craner left; Craner stayed', words: [] });
  const job = seedJob([cue], [csug('x', '0-0', 0, { cueText: cue.text })]);
  updateTranscript(job.id, (state) => { state.cues[0].text = 'Craner stayed'; reconcileSuggestions(state); });
  assert.equal(readTranscript(job.id).suggestions[0].status, 'stale');
  // Same for adding a copy in front of it.
  const j2 = seedJob([{ ...cue, text: 'Craner stayed' }], [csug('y', '0-0', 0, { cueText: 'Craner stayed' })]);
  updateTranscript(j2.id, (state) => { state.cues[0].text = 'Craner left; Craner stayed'; reconcileSuggestions(state); });
  assert.equal(readTranscript(j2.id).suggestions[0].status, 'stale');
});

test('a dismissed repeated-word flag stays dismissed after another occurrence is fixed', () => {
  const cue = craner('0-0');
  const other = [w('Crainer', 0, 1), w('called', 1, 2), w('Crainer', 2, 3)];
  const found = compareWords([cue], { 0: other }, 'X');
  const job = seedJob([cue], []);
  mergeSuggestions(job.id, found, 'compare', [cue]);
  const [first, second] = readTranscript(job.id).suggestions;
  updateTranscript(job.id, (state) => { state.suggestions.find((x) => x.id === second.id).status = 'dismissed'; });
  acceptSuggestion(job.id, first.id);
  const after = readTranscript(job.id);
  const snap = after.cues;
  mergeSuggestions(job.id, compareWords(snap, { 0: other }, 'X'), 'compare', snap);
  const st = readTranscript(job.id).suggestions;
  assert.equal(st.filter((x) => x.status === 'open').length, 0, JSON.stringify(st));
});

test('an overlapping line keeps its own correction when the earlier line could take it as an insertion', () => {
  const cues = [
    { id: '0-0', track: 0, start: 0, end: 1, text: 'Go', words: [w('Go', 0, 1)] },
    { id: '0-1', track: 0, start: 0.5, end: 0.8, text: 'Ron', words: [w('Ron', 0.5, 0.8)] },
  ];
  const found = compareWords(cues, { 0: [w('Go', 0, 1), w('Run', 0.5, 0.8)] }, 'X');
  assert.deepEqual(found.map((f) => `${f.from} -> ${f.to}`), ['Ron -> Run']);
});

test('adding an unedited missed line keeps the heard timings and speakers despite the capital letter', () => {
  const words = [{ ...w('hey', 3, 3.2), speaker: 0 }, { ...w('run', 4, 4.2), speaker: 1 }];
  const line = { id: 'l2', kind: 'insert-line', cueId: null, track: 0, start: 3, end: 4.2, text: 'Hey run', words, from: '', to: 'Hey run', source: 'compare', status: 'open' };
  const job = seedJob([{ id: '0-0', track: 0, start: 20, end: 21, text: 'Bye.', words: [] }], [line]);
  const r = acceptSuggestion(job.id, 'l2');
  assert.deepEqual(r.cues.map((c) => [c.text, c.start, c.speaker]), [['Hey', 3, 0], ['run', 4, 1]]);
});

test('fixing one name keeps the other outstanding fixes open, ignored ones included', () => {
  const cue = craner('0-0');
  const job = seedJob([cue], [
    csug('a', '0-0', 0, { to: 'Josh', cueText: cue.text }),
    csug('b', '0-0', 1, { to: 'Josh', cueText: cue.text }),
  ]);
  acceptSuggestion(job.id, 'a');
  const st = readTranscript(job.id);
  assert.equal(st.cues[0].text, 'Josh called Craner');
  assert.equal(st.suggestions.find((x) => x.id === 'b').status, 'open');
  // Dismissed second name: accept the first, rerun comparison, no new flag appears.
  const j2 = seedJob([craner('0-0')], [
    csug('a', '0-0', 0, { to: 'Josh', cueText: cue.text }),
    csug('b', '0-0', 1, { to: 'Josh', cueText: cue.text, status: 'dismissed' }),
  ]);
  acceptSuggestion(j2.id, 'a');
  const snap = readTranscript(j2.id).cues;
  const other = [w('Josh', 0, 1), w('called', 1, 2), w('Josh', 2, 3)];
  mergeSuggestions(j2.id, compareWords(snap, { 0: other }, 'X'), 'compare', snap);
  const s2 = readTranscript(j2.id).suggestions;
  assert.equal(s2.filter((x) => x.status === 'open').length, 0, JSON.stringify(s2));
});

test('an insertion into one line is not turned into a correction of the next line', () => {
  const cues = [
    { id: '0-0', track: 0, start: 0, end: 1, text: 'Go', words: [w('Go', 0, 0.6)] },
    { id: '0-1', track: 0, start: 1, end: 1.3, text: 'Right', words: [w('Right', 1, 1.3)] },
  ];
  const found = compareWords(cues, { 0: [w('Go', 0, 0.6), w('now', 0.65, 0.9)] }, 'X');
  assert.deepEqual(found.map((f) => `${f.from} -> ${f.to}`), ['Go -> Go now']);
});

// ---- noise filters: spelling variants, cut-off words, fillers
const mk = (text, t0 = 0) => {
  const ws = text.split(' ').map((x, i) => w(x, t0 + i * 0.5, t0 + i * 0.5 + 0.4));
  return { id: 'n-' + text.length, track: 0, start: t0, end: t0 + ws.length * 0.5, text, words: ws };
};
const seq = (text, t0 = 0) => text.split(' ').map((x, i) => w(x, t0 + i * 0.5, t0 + i * 0.5 + 0.4));
const cmp = (ours, theirs) => compareWords([mk(ours)], { 0: seq(theirs) }, 'X');

test('compareWords ignores informal spellings, contractions and number formats', () => {
  for (const [a, b] of [
    ['it was kind of big', 'it was kinda big'], ['we want to go now', 'we wanna go now'],
    ['we are going to win', 'we are gonna win'], ['I got to leave', 'I gotta leave'],
    ['the freaking door', 'the fricking door'], ['yeah that works', 'yep that works'],
    ['alright let us start', 'all right let us start'], ['what is it for', "what's it for"],
    ['a 3x2 grid here', 'a three by two grid here'], ['we need 5 more bars', 'we need five more bars'],
    ['I am going to look', "I'ma look"],
  ]) assert.deepEqual(cmp(a, b), [], `${a} / ${b}`);
});

test('compareWords still flags real word changes next to a spelling variant', () => {
  const found = cmp('it was kind of green', 'it was kinda grin');
  assert.equal(found.length, 1);
  assert.match(found[0].from, /green/);
});

test('compareWords ignores cut-off words and stray fragments', () => {
  assert.deepEqual(cmp('we need chill vibes', 'we need ch vibes'), []);
  assert.deepEqual(cmp('a new product here', 'a new pro- here'), []);
  assert.deepEqual(cmp('so we go home', 'so we sl go home'), []);
  assert.deepEqual(cmp('so we go home', 'so we h uh go home'), []);
});

test('compareWords keeps real short words and different words', () => {
  assert.equal(cmp('oh gosh almost died', 'oh gosh I almost died').length, 1);
  assert.equal(cmp('I like sky scones', 'I like sky stones').length, 1);
  assert.equal(cmp('he said your name', "he said you're name").length, 1);
});

test('compareWords ignores filler or backchannel swapped for filler', () => {
  assert.deepEqual(cmp('okay so yeah then', 'okay so uh-huh yep then'), []);
  assert.deepEqual(cmp('right so um then', 'right so uh then'), []);
});

test('missing lines need two real words, not fillers or cut-off fragments', () => {
  const run = (text) => compareWords([mk('hello there friend', 0)], { 0: [...seq('hello there friend', 0), ...seq(text, 20)] }, 'X').filter((s) => s.kind === 'insert-line');
  assert.equal(run('It ki-').length, 0);
  assert.equal(run('Uh-huh. Uh-huh.').length, 0);
  assert.equal(run('Chest, uh-huh.').length, 0);
  assert.equal(run('I did not see it').length, 1);
});
