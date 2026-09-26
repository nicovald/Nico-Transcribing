import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareWords, replacePhrase } from './suggestions.js';

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
