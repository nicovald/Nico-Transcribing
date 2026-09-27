import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'transcriber-memory-'));
process.env.DATA_DIR = temp;
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const memory = await import('./memory.js');

const cue = (id, text) => ({ id, track: 0, start: 0, end: 1, text, words: [], edited: false });
const found = (cues) => memory.memoryCheck(cues).map((s) => `${s.from} -> ${s.to} (${s.tier})`);

// A studio's people list, as it would arrive through its settings file.
const CREW = [
  { name: 'SSundee', aka: ['Ian'], heardAs: ['Sundee', 'Sunday', 'S Sundee'] },
  { name: 'Crainer', aka: ['Benjamin'], heardAs: ['Craner', 'Crayner', 'Crane her'] },
  { name: 'Lookum', aka: [], heardAs: ['Look um', 'Lookem', 'Lookam'] },
  { name: 'Pat', aka: [], heardAs: [] },
  { name: 'Nico', aka: ['Nico Vald'], heardAs: ['Neko'] },
  { name: 'Roman', aka: [], heardAs: [] },
];

test('first run starts with an empty people list; a saved list feeds the proofreader', () => {
  assert.deepEqual(memory.getMemory().people, []);
  memory.savePeople(CREW);
  const names = memory.getMemory().people.map((p) => p.name);
  assert.deepEqual(names, ['SSundee', 'Crainer', 'Lookum', 'Pat', 'Nico', 'Roman']);
  assert.match(memory.peopleContext(), /SSundee \(also called Ian\)/);
});

test('fixes move from "not sure" to "usually this" as they keep getting accepted', () => {
  assert.equal(memory.tierOf({ fixed: 1, ignored: 0 }), 'unsure');
  assert.equal(memory.tierOf({ fixed: 3, ignored: 0 }), 'usual');
  assert.equal(memory.tierOf({ fixed: 7, ignored: 1 }), 'unsure');
  assert.equal(memory.tierOf({ fixed: 9, ignored: 1 }), 'usual');
  assert.equal(memory.tierOf({ fixed: 1, ignored: 3 }), null);
  assert.equal(memory.tierOf({ fixed: 0, ignored: 0, pin: 'usual' }), 'usual');
  assert.equal(memory.tierOf({ fixed: 9, ignored: 0, pin: 'never' }), null);
});

test('accepting and ignoring build up a learned fix', () => {
  const lines = [cue('0-0', 'We need more couples stone.')];
  memory.recordFix('couples stone', 'Cobblestone', { fixed: 1 });
  assert.deepEqual(found(lines), ['couples stone -> Cobblestone (unsure)']);
  memory.recordFix('Couples Stone', 'Cobblestone', { fixed: 2 });
  assert.deepEqual(found(lines), ['couples stone -> Cobblestone (usual)']);
  memory.recordFix('couples stone', 'Cobblestone', { ignored: 1 });
  assert.deepEqual(found(lines), ['couples stone -> Cobblestone (unsure)']);
  assert.deepEqual(found([cue('0-1', 'More Cobblestone.')]), []);
  assert.ok(memory.memoryKeyterms().includes('SSundee'));
});

test('everyday words are never learned', () => {
  memory.recordFix('a', 'the', { fixed: 5 });
  memory.recordFix('gonna', 'going to', { fixed: 5 });
  memory.recordFix('There', 'Their', { fixed: 5 });
  assert.equal(memory.getMemory().fixes.some((f) => ['a', 'There', 'gonna'].includes(f.from)), false);
});

test('a small hand edit is a lesson, a rewrite is not', () => {
  assert.deepEqual(memory.learnedFromEdit('We need more couples stone.', 'We need more Cobblestone.'), { from: 'couples stone', to: 'Cobblestone' });
  assert.deepEqual(memory.learnedFromEdit('Hey Craner, look', 'Hey Crainer, look'), { from: 'Craner', to: 'Crainer' });
  assert.equal(memory.learnedFromEdit('We need more stone.', 'Honestly I think the whole base should be moved somewhere else entirely.'), null);
  assert.equal(memory.learnedFromEdit('Same text', 'Same text!'), null);
});

test('names are caught by sound, possessives and split words included', () => {
  assert.deepEqual(found([cue('1', 'Wait, look at Craners base.')]), ["Craners -> Crainer's (unsure)"]);
  assert.deepEqual(found([cue('2', 'Sunday, did you grab it?')]), ['Sunday -> SSundee (unsure)']);
  assert.deepEqual(found([cue('3', 'Hey Look um, over here.')]), ['Look um -> Lookum (unsure)']);
  assert.deepEqual(found([cue('4', 'Crainer and SSundee and Lookum are here.')]), []);
  assert.deepEqual(found([cue('5', 'Take a look in the chest.')]), []);
});

test('importing a teammate file merges without double counting', () => {
  const file = {
    kind: 'grok-transcriber-memory',
    version: 1,
    people: [{ name: 'crainer', aka: ['Ben'], heardAs: ['Crane'] }, { name: 'Jev', aka: [], heardAs: [] }],
    fixes: [{ from: 'couples stone', to: 'Cobblestone', fixed: 10, ignored: 0 }, { from: 'red stone', to: 'Redstone', fixed: 4, ignored: 0 }],
  };
  const first = memory.importMemory(file);
  assert.deepEqual([first.people, first.fixes], [1, 1]);
  const again = memory.importMemory(file);
  assert.deepEqual([again.people, again.fixes], [0, 0]);
  const m = memory.getMemory();
  assert.deepEqual(m.people.find((p) => p.name === 'Crainer').aka, ['Benjamin', 'Ben']);
  assert.equal(m.fixes.find((f) => f.from === 'couples stone').fixed, 10);
  assert.throws(() => memory.importMemory({ people: [] }), /not a memory file exported/);
});
