import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTermListPrompt, parseTermListAnswer } from './aiTermList.js';

test('the prompt names the game and asks for the importable JSON', () => {
  const p = buildTermListPrompt('ATM10 To The Sky', 'Minecraft 1.21 modpack');
  assert.match(p, /words from ATM10 To The Sky correctly/);
  assert.match(p, /Extra context: Minecraft 1\.21 modpack/);
  assert.match(p, /"kind":"grok-transcriber-term-list"/);
  assert.match(buildTermListPrompt(''), /\[GAME OR MODPACK NAME\]/);
});

test('answers are parsed even with code fences and chatter around them', () => {
  const answer = 'Sure! Here you go:\n```json\n{"kind":"grok-transcriber-term-list","version":1,"name":"Terraria","terms":["Moon Lord","Terraprisma","moon lord"],"glossary":["Zenith","Moon Lord","Eye of Cthulhu"]}\n```\nEnjoy!';
  const list = parseTermListAnswer(answer);
  assert.equal(list.name, 'Terraria');
  assert.equal(list.terms, 'Moon Lord, Terraprisma');
  assert.equal(list.glossary, 'Moon Lord\nTerraprisma\nZenith\nEye of Cthulhu');
});

test('string lists and missing names are accepted; junk is explained', () => {
  const list = parseTermListAnswer('{"terms":"Creeper, Enderman","glossary":"Creeper\\nWarden"}', 'Minecraft');
  assert.equal(list.name, 'Minecraft');
  assert.equal(list.glossary, 'Creeper\nEnderman\nWarden');
  assert.equal(parseTermListAnswer('{"terms":[],"glossary":"Bucket of Salmon, Raw\\nCod"}').glossary, 'Bucket of Salmon, Raw\nCod');
  assert.throws(() => parseTermListAnswer('I cannot help with that.'), /doesn't look like/);
  assert.throws(() => parseTermListAnswer('{"terms": ["Creeper", '), /cut off/);
  assert.throws(() => parseTermListAnswer('{"terms": []}'), /no names/);
});
