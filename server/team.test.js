import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTeamEnv } from './team.js';

test('team .env files map common key names to services', () => {
  const r = parseTeamEnv(`# Studio keys
XAI_API_KEY=xai-123
export OPENAI_API_KEY="sk-abc # not a comment"
ANTHROPIC_API_KEY='sk-ant-1'   
DEEPGRAM_API_KEY=dg-1 # trailing comment
ELEVENLABS_API_KEY=
SOMETHING_ELSE=1
not a line`);
  assert.deepEqual(r.keys, { grok: 'xai-123', openai: 'sk-abc # not a comment', anthropic: 'sk-ant-1', deepgram: 'dg-1' });
  assert.deepEqual(r.services, ['Grok (xAI)', 'OpenAI', 'Claude (Anthropic)', 'Deepgram']);
  assert.deepEqual(r.ignored, ['SOMETHING_ELSE']);
});
