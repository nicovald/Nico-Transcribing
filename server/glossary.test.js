import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glossaryCheck, parseTermList, soundKey, termPicker } from './glossary.js';

const cue = (id, text) => ({ id, text, words: [] });
const MINECRAFT = ['Stone', 'Cobblestone', 'Silicon', 'Fire Brick', 'Netherite Ingot', 'Ender Pearl', 'Creeper', 'Diamond Pickaxe', 'Redstone'];

test('soundKey matches split compound mishearings', () => {
  assert.equal(soundKey('Couples Stone'), soundKey('Cobblestone'));
  assert.equal(soundKey('silicone'), soundKey('Silicon'));
});

test('glossaryCheck finds sound-alike phrases', () => {
  const found = glossaryCheck(
    [cue('a', 'All I wanna do is destroy Couples Stone!'), cue('b', 'We need more silicone.'), cue('c', 'Give me fire break.'), cue('d', 'Throw the ender pearl!')],
    MINECRAFT,
  );
  assert.deepEqual(
    found.map((f) => [f.cueId, f.from, f.to]),
    [
      ['a', 'Couples Stone', 'Cobblestone'],
      ['b', 'silicone', 'Silicon'],
      ['c', 'fire break', 'Fire Brick'],
    ],
  );
});

test('glossaryCheck leaves ordinary speech and correct terms alone', () => {
  const found = glossaryCheck(
    [cue('a', 'I think we should go home now.'), cue('b', 'That creeper blew up my redstone.'), cue('c', 'Stop, stun it, stain.')],
    MINECRAFT,
  );
  assert.deepEqual(found, []);
});

test('parseTermList handles lines, commas, CSV and JSON', () => {
  assert.deepEqual(parseTermList('Stone\nCobblestone, Dirt\n\nstone'), ['Stone', 'Cobblestone', 'Dirt']);
  assert.deepEqual(parseTermList('[{"displayName":"Stone"},{"name":"Dirt"},"Sand"]'), ['Stone', 'Dirt', 'Sand']);
  assert.deepEqual(parseTermList('"Stone";"Oak Log"\t"Sand"'), ['Stone', 'Oak Log', 'Sand']);
});

test('termPicker sends only related names from a big list', () => {
  const filler = Array.from({ length: 3000 }, (_, i) => `Decorative Block ${i}`);
  const pick = termPicker([...filler, 'Cobblestone', 'Fluix ME Glass Cable', 'Certus Quartz Crystal', 'Silicon Press']);
  const picked = pick('Destroy Couples Stone!\nME drive, fluid, semi, glass, cable.');
  assert.ok(picked.includes('Cobblestone'));
  assert.ok(picked.includes('Fluix ME Glass Cable'));
  assert.ok(!picked.includes('Silicon Press'));
  assert.ok(picked.length < 20, `picked ${picked.length}`);
});

test('glossaryCheck picks the closest of several terms sharing a sound', () => {
  for (const terms of [['Kroner', 'Crainer'], ['Crainer', 'Kroner']]) {
    assert.deepEqual(glossaryCheck([cue('a', 'Crayner did it.')], terms).map((f) => f.to), ['Crainer'], terms.join());
    assert.deepEqual(glossaryCheck([cue('a', 'Crayner did it.')], terms, { names: true }).map((f) => f.to), ['Crainer'], terms.join());
  }
});

test('termPicker keeps every term sharing a sound, closest first', () => {
  for (const terms of [['Kroner', 'Crainer'], ['Crainer', 'Kroner']]) {
    const picked = termPicker(terms)('Crayner is here');
    assert.equal(picked[0], 'Crainer', terms.join());
    assert.ok(picked.includes('Kroner'));
  }
});

test('glossaryCheck accepts first letters that sound the same', () => {
  assert.deepEqual(glossaryCheck([cue('a', 'Kraner did it.')], ['Crainer']).map((f) => [f.from, f.to]), [['Kraner', 'Crainer']]);
});

test('glossaryCheck checks edited cues but leaves locked phrases alone', () => {
  const edited = (id, text, locked) => ({ ...cue(id, text), edited: true, locked });
  // Old edited cues (no locked list) are skipped as before.
  assert.deepEqual(glossaryCheck([edited('a', 'Destroy Couples Stone!')], MINECRAFT), []);
  // With a locked list, only the accepted phrase is protected.
  const found = glossaryCheck([edited('a', 'Destroy Couples Stone and silicone!', ['couples stone'])], MINECRAFT);
  assert.deepEqual(found.map((f) => [f.from, f.to]), [['silicone', 'Silicon']]);
  assert.deepEqual(glossaryCheck([edited('b', 'Destroy Couples Stone!', [])], MINECRAFT).map((f) => f.to), ['Cobblestone']);
});

test('parseTermList keeps quoted CSV cells with commas together', () => {
  assert.deepEqual(parseTermList('"Bucket of Salmon, Raw",Stone\n"Say ""Hi""";Dirt'), ['Bucket of Salmon, Raw', 'Stone', 'Say "Hi"', 'Dirt']);
  assert.deepEqual(parseTermList('"Unclosed, quote\nSand'), ['Unclosed, quote', 'Sand']);
});

test('glossary locks use matched character ranges and name the occurrence', () => {
  const partial = { id: 'a', text: 'Couples stone wall', edited: true, locked: ['stone wall'], words: [] };
  assert.deepEqual(glossaryCheck([partial], ['Cobblestone']), []);
  const two = { id: 'b', text: 'Kraner called Kraner', edited: true, locked: ['Kraner called'], words: [] };
  const found = glossaryCheck([two], ['Crainer']);
  assert.equal(found.length, 1);
  assert.equal(found[0].occurrence, 1);
});
