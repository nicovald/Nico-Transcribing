import test from 'node:test';
import assert from 'node:assert/strict';
import { countTokens, estimateTokens, keytermLimits, limitKeyterms, splitKeyterms } from './providers/http.js';
import { providers } from './providers/index.js';

test('splitKeyterms keeps quoted commas and survives a stray quote', () => {
  assert.deepEqual(splitKeyterms('Sundee, "Bucket of Salmon, Raw"\nCrainer,,'), ['Sundee', 'Bucket of Salmon, Raw', 'Crainer']);
  assert.deepEqual(splitKeyterms('Ian "the, Crainer'), ['Ian "the', 'Crainer']);
  assert.deepEqual(splitKeyterms([' a ', '', 'b, c']), ['a', 'b, c']);
});

test('limitKeyterms dedupes case-insensitively and keeps order', () => {
  const { terms, total } = limitKeyterms(['Sundee', 'sundee', 'Crainer', 'SUNDEE', 'Lookum']);
  assert.deepEqual(terms, ['Sundee', 'Crainer', 'Lookum']);
  assert.equal(total, 3);
});

test('grok sends at most 100 terms of 50 characters', () => {
  const many = Array.from({ length: 150 }, (_, i) => `term${i}`);
  const { terms, total } = limitKeyterms(['x'.repeat(51), ...many], keytermLimits(providers.grok));
  assert.equal(terms.length, 100);
  assert.equal(terms[0], 'term0');
  assert.equal(total, 151);
});

test('deepgram stays under its token budget', () => {
  const many = Array.from({ length: 400 }, (_, i) => `Minecraft item ${i}`);
  const { terms } = limitKeyterms(many, keytermLimits(providers.deepgram));
  const tokens = terms.reduce((n, t) => n + estimateTokens(t), 0);
  assert.ok(tokens <= 450, `${tokens} tokens`);
  assert.ok(terms.length > 20);
  assert.equal(terms[0], 'Minecraft item 0');
});

test('openai vocabulary prompt fits in ~200 tokens, most important first', () => {
  const many = Array.from({ length: 300 }, (_, i) => `Name${i}`);
  const { terms } = limitKeyterms(['Sundee', ...many], keytermLimits(providers.openai));
  const prompt = `Vocabulary: ${terms.join(', ')}.`;
  assert.ok(countTokens(prompt) <= 200, prompt);
  assert.equal(terms[0], 'Sundee');
});

test('handle-like terms are counted conservatively', () => {
  assert.equal(countTokens('X10Y10Z10'), 9);
  const handles = Array.from({ length: 45 }, (_, i) => `X${10 + i}Y${10 + i}Z${10 + i}`);
  const open = limitKeyterms(handles, keytermLimits(providers.openai)).terms;
  assert.ok(open.length < 45 && open.length > 5);
  assert.ok(countTokens(`Vocabulary: ${open.join(', ')}.`) <= 200, 'bound incl. separators');
  // Whisper tokenizes X10Y10Z10 into at least 6 pieces, so the real count stays under 224.
  assert.ok(open.length * 6 + 5 <= 224);
  const dg = limitKeyterms(handles.concat(handles.map((h) => h + 'W9')), keytermLimits(providers.deepgram)).terms;
  assert.ok(dg.reduce((n, t) => n + estimateTokens(t), 0) <= 450);
});

test('assemblyai request body: legacy overrides use default routing, current IDs are sent', async () => {
  const { MockAgent } = await import('undici');
  const { setDispatcher } = await import('./providers/http.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const agent = new MockAgent();
  agent.disableNetConnect();
  const pool = agent.get('https://api.assemblyai.com');
  const sent = [];
  pool.intercept({ path: '/v2/upload', method: 'POST' }).reply(200, { upload_url: 'https://x/a' }).persist();
  pool.intercept({ path: '/v2/transcript', method: 'POST' }).reply(200, (o) => { sent.push(JSON.parse(o.body)); return { id: 't', status: 'completed', words: [] }; }).persist();
  setDispatcher(agent);
  const file = path.join(os.tmpdir(), 'aai-test.flac');
  fs.writeFileSync(file, 'x');
  try {
    for (const model of ['best', 'nano', 'universal', 'slam-1', 'default', '']) {
      await providers.assemblyai.transcribe({ file, key: 'k', model, options: { keyterms: ['a'] } });
    }
    await providers.assemblyai.transcribe({ file, key: 'k', model: 'universal-2', options: { keyterms: ['a'] } });
    await providers.assemblyai.transcribe({ file, key: 'k', model: 'universal-3-5-pro, universal-2', options: {} });
  } finally { fs.rmSync(file, { force: true }); await agent.close(); }
  assert.equal(sent.length, 8);
  for (const body of sent.slice(0, 6)) assert.equal('speech_models' in body, false);
  assert.deepEqual(sent[6].speech_models, ['universal-2']);
  assert.deepEqual(sent[7].speech_models, ['universal-3-5-pro', 'universal-2']);
  assert.equal(keytermLimits(providers.assemblyai, 'best', { language: 'en' }).max, 1000);
  assert.equal(keytermLimits(providers.assemblyai, 'universal-2').max, 200);
});

test('assemblyai allows 1000 (200 on universal-2) and 6 words', () => {
  const many = Array.from({ length: 1200 }, (_, i) => `t${i}`);
  assert.equal(limitKeyterms(many, keytermLimits(providers.assemblyai, '', { language: 'en' })).terms.length, 1000);
  assert.equal(limitKeyterms(many, keytermLimits(providers.assemblyai, 'universal-2')).terms.length, 200);
  assert.deepEqual(limitKeyterms(['one two three four five six seven', 'ok'], keytermLimits(providers.assemblyai, '', { language: 'en' })).terms, ['ok']);
});

test('elevenlabs filters by its rules', () => {
  const input = ['ok', 'x'.repeat(50), 'x'.repeat(49), 'a b c d e f', 'a b c d e', 'a<b', 'c{d}', 'e[f]', 'g\\h'];
  assert.deepEqual(limitKeyterms(input, keytermLimits(providers.elevenlabs)).terms, ['ok', 'x'.repeat(49), 'a b c d e']);
});

test('assemblyai caps at 200 whenever universal-2 is reachable', () => {
  const cap = (model, options) => keytermLimits(providers.assemblyai, model, options).max;
  assert.equal(cap('universal-3-5-pro, universal-2'), 200);
  assert.equal(cap('universal-2, universal-3-5-pro'), 200);
  assert.equal(cap('universal-3-5-pro'), 1000);
  assert.equal(cap('', {}), 200); // default routing, language unknown: may fall back to universal-2
  assert.equal(cap('', { language: 'en' }), 1000);
  assert.equal(cap('', { language: 'es' }), 200);
});

test('a pathological no-vowel handle cannot overrun the openai prompt budget', () => {
  const handle = 'qz'.repeat(240); // 480 letters, no merges in Whisper's vocabulary
  const { terms } = limitKeyterms([handle, 'Sundee'], keytermLimits(providers.openai));
  assert.deepEqual(terms, ['Sundee']);
  assert.ok(countTokens('Vocabulary: ' + handle + '.') >= 480);
  const many = Array.from({ length: 300 }, (_, i) => `Name${i}`);
  const list = limitKeyterms(['Sundee', ...many], keytermLimits(providers.openai)).terms;
  assert.equal(list[0], 'Sundee');
});

test('openai prompt puts the most important terms last', async () => {
  const { MockAgent } = await import('undici');
  const { setDispatcher } = await import('./providers/http.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const agent = new MockAgent();
  agent.disableNetConnect();
  let body = '';
  agent.get('https://api.openai.com').intercept({ path: '/v1/audio/transcriptions', method: 'POST' }).reply(200, (o) => { body = o.body?.get?.('prompt') ?? ''; return { words: [], segments: [] }; });
  setDispatcher(agent);
  const file = path.join(os.tmpdir(), 'oai-test.mp3');
  fs.writeFileSync(file, 'x');
  try { await providers.openai.transcribe({ file, key: 'k', model: '', options: { keyterms: ['First', 'Second', 'Third'] } }); }
  finally { fs.rmSync(file, { force: true }); await agent.close(); }
  assert.equal(body, 'Vocabulary: Third, Second, First.');
});

test('deepgram retries once with half the terms on a 400 about keyterm tokens', async () => {
  const { MockAgent } = await import('undici');
  const { setDispatcher } = await import('./providers/http.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const agent = new MockAgent();
  agent.disableNetConnect();
  const pool = agent.get('https://api.deepgram.com');
  const seen = [];
  const at = (p) => p.startsWith('/v1/listen');
  const count = (o) => seen.push((o.path.match(/keyterm=/g) || []).length);
  pool.intercept({ path: at, method: 'POST' }).reply(400, (o) => { count(o); return { err_code: 'INVALID_QUERY_PARAMETER', err_msg: 'Keyterm prompting exceeds the token limit' }; });
  pool.intercept({ path: at, method: 'POST' }).reply(200, (o) => { count(o); return { results: { channels: [{ alternatives: [{ words: [] }] }] } }; });
  setDispatcher(agent);
  const file = path.join(os.tmpdir(), 'dg-test.flac');
  fs.writeFileSync(file, 'x');
  try { await providers.deepgram.transcribe({ file, key: 'k', model: '', options: { keyterms: ['a1', 'b2', 'c3', 'd4'] } }); }
  finally { fs.rmSync(file, { force: true }); await agent.close(); }
  assert.deepEqual(seen, [4, 2]);
});
