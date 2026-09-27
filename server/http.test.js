import test from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from './providers/http.js';

test('xAI credits/spending-limit 403 names the service and drops the team ID', () => {
  const msg = describeError('https://api.x.ai/v1/stt', 403, 'Your team 4391d5d8-188d-4714-b46e-f943d36c0ce2 has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.');
  assert.match(msg, /^Grok \(xAI\) account is out of prepaid credits or hit its monthly spending limit/);
  assert.match(msg, /console\.x\.ai/);
  assert.doesNotMatch(msg, /4391d5d8/);
});

test('OpenAI insufficient quota names OpenAI and keeps the detail', () => {
  const msg = describeError('https://api.openai.com/v1/audio/transcriptions', 429, 'You exceeded your current quota, please check your plan and billing details.');
  assert.match(msg, /^OpenAI account is out of credits/);
  assert.match(msg, /HTTP 429: You exceeded/);
});

test('rate limits say which service is throttling', () => {
  assert.match(describeError('https://api.openai.com/x', 429, 'Rate limit reached for requests per minute'), /^OpenAI is rate-limiting/);
});

test('other errors are prefixed with the service name', () => {
  assert.match(describeError('https://api.x.ai/x', 401, 'Incorrect API key'), /^Grok \(xAI\) rejected the API key/);
  assert.equal(describeError('https://api.deepgram.com/v1/listen', 400, 'Bad audio'), 'Deepgram: HTTP 400: Bad audio');
  assert.match(describeError('https://api.anthropic.com', 400, 'Your credit balance is too low to access the Anthropic API.'), /^Claude \(Anthropic\) account is out of credits/);
});
