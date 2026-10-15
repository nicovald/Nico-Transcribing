import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// jobs.js pulls in store.js, so point it at a throwaway data folder first.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'transcriber-chunks-'));
process.env.DATA_DIR = path.join(temp, 'data');
const store = await import('./store.js');
const { chunkPlan, repairWords, resolveKeytermList, resolveKeyterms, stitchChunks } = await import('./jobs.js');
after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('a short track is one chunk', () => {
  assert.deepEqual(chunkPlan(300, 600, 8), [{ start: 0, length: undefined, ownStart: -Infinity, ownEnd: Infinity }]);
  assert.equal(chunkPlan(300, undefined).length, 1);
});

test('chunks overlap on both sides and own back-to-back intervals', () => {
  const plan = chunkPlan(1500, 600, 8);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan[0], { start: 0, length: 608, ownStart: -Infinity, ownEnd: 600 });
  assert.deepEqual(plan[1], { start: 592, length: 616, ownStart: 600, ownEnd: 1200 });
  assert.deepEqual(plan[2], { start: 1192, length: 616, ownStart: 1200, ownEnd: Infinity });
});

// Chunk 1 of chunkPlan(1200, 600, 8) starts at 592 s, so its local times are global - 592.
const local1 = (words) => words.map((w) => ({ ...w, start: +(w.start - 592).toFixed(3), end: +(w.end - 592).toFixed(3) }));
const stitchPair = (c0, c1Global) => stitchChunks([c0, local1(c1Global)], chunkPlan(1200, 600, 8));

test('stitching keeps a word heard in two chunks exactly once', () => {
  const both = [{ text: 'early', start: 594, end: 594.5 }, { text: 'straddle', start: 599.8, end: 600.3 }, { text: 'tail', start: 604, end: 604.4 }];
  const out = stitchPair([{ text: 'start', start: 1, end: 1.4 }, ...both], both);
  assert.deepEqual(out.map((w) => w.text), ['start', 'early', 'straddle', 'tail']);
  assert.equal(out.find((w) => w.text === 'tail').start, 604);
});

test('stitching keeps one copy when the chunks time a cut word differently', () => {
  // Chunk 0 puts the midpoint after 600, chunk 1 before it: once dropped both, the other way kept both.
  for (const [a, b] of [[[599.95, 600.25], [599.7, 600.1]], [[599.7, 600.1], [599.95, 600.25]]]) {
    const out = stitchPair([{ text: 'Crainer', start: a[0], end: a[1] }], [{ text: 'Crainer', start: b[0], end: b[1] }]);
    assert.equal(out.length, 1, JSON.stringify(out));
    assert.equal(out[0].text, 'Crainer');
  }
  // Same with neighbors on both sides, and a silence elsewhere in the overlap to splice at.
  const out = stitchPair(
    [{ text: 'hi', start: 597, end: 597.3 }, { text: 'Crainer', start: 599.95, end: 600.25 }, { text: 'says', start: 600.3, end: 600.6 }],
    [{ text: 'hi', start: 597.05, end: 597.3 }, { text: 'Crainer.', start: 599.7, end: 600.1 }, { text: 'says', start: 600.32, end: 600.6 }, { text: 'more', start: 610, end: 610.3 }],
  );
  assert.deepEqual(out.map((w) => w.text.replace('.', '')), ['hi', 'Crainer', 'says', 'more']);
});

test('stitching aligns by text: an overlapping neighbor only one chunk heard survives', () => {
  const out = stitchPair(
    [{ text: 'Go', start: 599.9, end: 600.4 }, { text: 'Crainer', start: 600.2, end: 600.5 }],
    [{ text: 'Go', start: 599.9, end: 600.4 }],
  );
  assert.deepEqual(out.map((w) => w.text), ['Go', 'Crainer']);
});

test('stitching aligns by text: one name timed far apart by the chunks is kept once', () => {
  for (const [a, b] of [[[599.7, 599.9], [600.1, 600.3]], [[600.1, 600.3], [599.7, 599.9]]]) {
    const out = stitchPair([{ text: 'Crainer', start: a[0], end: a[1] }], [{ text: 'Crainer', start: b[0], end: b[1] }]);
    assert.deepEqual(out.map((w) => w.text), ['Crainer']);
  }
});

test('stitching keeps a word only one chunk heard', () => {
  // Chunk 0 missed "Lookum" before the cut; chunk 1 missed "Pat" after it.
  const out = stitchPair(
    [{ text: 'and', start: 596, end: 596.2 }, { text: 'Pat', start: 602, end: 602.3 }],
    [{ text: 'and', start: 596, end: 596.2 }, { text: 'Lookum', start: 598, end: 598.4 }, { text: 'end', start: 605, end: 605.2 }],
  );
  assert.deepEqual(out.map((w) => w.text), ['and', 'Lookum', 'Pat', 'end']);
});

test('stitching three chunks keeps every seam clean', () => {
  const plan = chunkPlan(1500, 600, 8);
  const words = [[1, 'a'], [599.9, 'b'], [601, 'c'], [900, 'd'], [1199.8, 'e'], [1203, 'f']].map(([t, text]) => ({ text, start: t, end: t + 0.4 }));
  const forChunk = (p) => words.filter((w) => w.start >= p.start && w.end <= p.start + p.length).map((w) => ({ ...w, start: w.start - p.start, end: w.end - p.start }));
  const out = stitchChunks(plan.map(forChunk), plan);
  assert.deepEqual(out.map((w) => w.text), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.ok(Math.abs(out.at(-1).start - 1203) < 1e-9);
});

test('repairWords borrows neighbor times and drops junk', () => {
  const out = repairWords([
    { text: 'a', start: 1, end: 1.2 },
    { text: 'b', start: null, end: null },
    { text: 'c', start: 1.5, end: null },
    { text: '', start: 2, end: 2.1 },
    { text: 'd', start: 3, end: 2.5 },
  ], 'ElevenLabs Scribe');
  assert.deepEqual(out.map((w) => [w.text, w.start, w.end]), [['a', 1, 1.2], ['b', 1.2, 1.5], ['c', 1.5, 1.5], ['d', 3, 3]]);
});

test('repairWords fails only when most words are unusable', () => {
  assert.throws(() => repairWords([{ text: 'a' }, { text: 'b' }, { text: 1, start: 0, end: 1 }], 'ElevenLabs Scribe'), /ElevenLabs Scribe returned words without usable timings/);
  assert.equal(repairWords([{ text: 'a', start: 0, end: 1 }, { text: 5 }, { text: 'b', start: 1, end: 2 }]).length, 2);
  assert.deepEqual(repairWords([]), []);
  assert.throws(() => repairWords(null, 'Grok (xAI)'), /Grok \(xAI\) sent back a transcript/);
});

test('keyterms: people, usual fixes, extras, then lists in turn, deduped', () => {
  store.writeJson(path.join(store.DATA_DIR, 'memory.json'), {
    people: [{ id: '1', name: 'Sundee', heardAs: [] }],
    fixes: [{ id: 'f', from: 'couples stone', to: 'Cobblestone', fixed: 4, ignored: 0, pin: null }, { id: 'g', from: 'x', to: 'Unsure', fixed: 1, ignored: 0, pin: null }],
  });
  const settings = {
    termLists: [
      { id: 'a', name: 'A', terms: 'Creeper, Enderman, Wither, "Bucket of Salmon, Raw"' },
      { id: 'b', name: 'B', terms: 'Mekanism, sundee' },
    ],
  };
  const list = resolveKeytermList({ keyterms: 'Crainer, creeper', termListIds: ['a', 'b'] }, settings);
  assert.deepEqual(list, ['Sundee', 'Cobblestone', 'Crainer', 'creeper', 'Mekanism', 'Enderman', 'Wither', 'Bucket of Salmon, Raw']);
  assert.equal(resolveKeyterms({ keyterms: 'Crainer', termListIds: [] }, settings), 'Sundee, Cobblestone, Crainer');
});
