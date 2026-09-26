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
