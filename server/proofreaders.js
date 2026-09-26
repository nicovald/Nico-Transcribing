// LLM backends for the AI proofread pass. Each takes a system prompt, the transcript
// lines and a JSON schema, and returns the parsed JSON object.
import Anthropic from '@anthropic-ai/sdk';
import { request } from './providers/http.js';

export const proofreaders = {
  claude: {
    id: 'claude',
    name: 'Claude (Anthropic)',
    keyName: 'anthropic',
    defaultModel: 'claude-opus-5',
    async run({ key, model, system, user, schema, signal }) {
      const client = new Anthropic({ apiKey: key });
      const response = await client.beta.messages
        .create(
        {
          model,
          max_tokens: 16000,
          system,
          messages: [{ role: 'user', content: user }],
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
          // Re-run on Anthropic's recommended fallback model if the request is declined.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal },
        )
        .catch((err) => {
          if (err instanceof Anthropic.AuthenticationError) throw new Error('Your Anthropic key was rejected. Check it in Settings.');
          if (err instanceof Anthropic.NotFoundError) throw new Error(`Claude model "${model}" was not found. Check the model name in Settings.`);
          throw err;
        });
      if (response.stop_reason === 'refusal') throw new Error('Claude declined to proofread this part of the transcript.');
      if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of output room; try again.');
      const text = response.content.find((b) => b.type === 'text')?.text;
      return JSON.parse(text || '{}');
    },
  },

  openai: {
    id: 'openai',
    name: 'OpenAI',
    keyName: 'openai',
    defaultModel: 'gpt-5.6',
    async run({ key, model, system, user, schema, signal }) {
      const data = await request('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'fixes', schema, strict: true } },
        }),
        signal,
      });
      return JSON.parse(data.choices?.[0]?.message?.content || '{}');
    },
  },

  grok: {
    id: 'grok',
    name: 'Grok (xAI)',
    keyName: 'grok',
    defaultModel: 'grok-4.7',
    async run({ key, model, system, user, schema, signal }) {
      const data = await request('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'fixes', schema, strict: true } },
        }),
        signal,
      });
      return JSON.parse(data.choices?.[0]?.message?.content || '{}');
    },
  },
};

export const proofreaderList = () =>
  Object.values(proofreaders).map(({ id, name, keyName, defaultModel }) => ({ id, name, keyName, defaultModel }));

// The chosen proofreader, or the best one we have a key for.
export function pickProofreader(settings) {
  const chosen = proofreaders[settings.proofread.provider];
  if (chosen && settings.keys[chosen.keyName]) return chosen;
  return ['claude', 'openai', 'grok'].map((id) => proofreaders[id]).find((p) => settings.keys[p.keyName]) || null;
}
