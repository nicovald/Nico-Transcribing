import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCues, formatTimestamp, toSrt } from './srt.js';

const w = (text, start, end, extra = {}) => ({ text, start, end, confidence: null, speaker: null, ...extra });
const opts = { maxLineChars: 42, maxLines: 2, maxDuration: 6, pauseSplit: 0.8, minDuration: 0.8 };

test('formats SRT timestamps', () => {
  assert.equal(formatTimestamp(0), '00:00:00,000');
  assert.equal(formatTimestamp(3723.456), '01:02:03,456');
});

test('splits cues on sentence end, pauses and speaker change', () => {
  const words = [
    w('Hello', 0, 0.4), w('there.', 0.4, 0.8), w('How', 0.9, 1.1), w('are', 1.1, 1.2), w('you', 1.2, 1.4),
    w('doing', 3.0, 3.4), // long pause before
    w('fine', 3.5, 3.8, { speaker: 1 }), w('thanks', 3.8, 4.2, { speaker: 2 }),
  ];
  const cues = buildCues(words, opts);
  assert.deepEqual(cues.map((c) => c.text), ['Hello there.', 'How are you', 'doing fine', 'thanks']);
});

test('keeps cues within the character limit and balances two lines', () => {
  const words = Array.from({ length: 40 }, (_, i) => w('word', i * 0.1, i * 0.1 + 0.1));
  const cues = buildCues(words, opts);
  for (const c of cues) {
    const lines = c.text.split('\n');
    assert.ok(lines.length <= 2);
    for (const line of lines) assert.ok(line.length <= 42, line);
  }
});

test('extends short cues to the minimum duration without overlapping the next', () => {
  const cues = buildCues([w('Hi.', 0, 0.2), w('Yo.', 0.5, 0.7)], { ...opts, pauseSplit: 0.1 });
  assert.equal(cues[0].end, 0.5);
  assert.equal(cues[1].end, 1.3);
});

test('merged SRT sorts by time and prefixes labels', () => {
  const cues = [
    { track: 1, start: 2, end: 3, text: 'second' },
    { track: 0, start: 0, end: 1, text: 'first' },
  ];
  const srt = toSrt(cues, { label: (c) => ['Host', 'Guest'][c.track] });
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,000\n[Host] first\n\n2\n00:00:02,000 --> 00:00:03,000\n[Guest] second\n');
});
