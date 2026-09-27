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
    suggested: [{ id: 'claude-opus-5', note: 'best' }, { id: 'claude-sonnet-5', note: 'cheaper' }, { id: 'claude-haiku-4-5', note: 'cheapest' }],
    async listModels(key) {
      const client = new Anthropic({ apiKey: key });
      const ids = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    },
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
    // Fixed to the cheapest GPT-6 ($0.10 / $0.50 per 1M tokens): plenty for spotting misheard
    // words, and a studio paying for the key never gets a surprise bill from a pricier model.
    defaultModel: 'gpt-6-luna',
    fixedModel: true,
    suggested: [{ id: 'gpt-6-luna', note: 'cheapest GPT-6' }],
    listModels: async () => ['gpt-6-luna'],
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
    suggested: [],
    listModels: (key) => listOpenAiStyle('https://api.x.ai/v1/models', key, /^grok/, /(image|imagine|vision|voice|tts|stt|video)/),
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

// OpenAI-compatible GET /v1/models, kept to chat models.
async function listOpenAiStyle(url, key, keep, drop) {
  const data = await request(url, { headers: { Authorization: `Bearer ${key}` } });
  return (data.data || []).map((m) => m.id).filter((id) => keep.test(id) && !drop.test(id));
}

// Models the account can use, newest names first. Cached briefly so opening Settings stays fast.
const modelCache = new Map();
export async function availableModels(id, key) {
  const p = proofreaders[id];
  if (!p) throw Object.assign(new Error('Unknown proofreader.'), { status: 404 });
  const cacheKey = `${id}:${key.slice(-8)}`;
  const hit = modelCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.models;
  const models = [...new Set(await p.listModels(key))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  modelCache.set(cacheKey, { at: Date.now(), models });
  return models;
}

export const proofreaderList = () =>
  Object.values(proofreaders).map(({ id, name, keyName, defaultModel, suggested, fixedModel = false }) => ({ id, name, keyName, defaultModel, suggested, fixedModel }));

// The model a proofread actually uses: the saved choice, unless this proofreader's model is fixed.
export const modelFor = (proofreader, settings) =>
  (!proofreader.fixedModel && settings.proofread.models?.[proofreader.id]) || proofreader.defaultModel;

// The chosen proofreader, or the best one we have a key for.
export function pickProofreader(settings) {
  const chosen = proofreaders[settings.proofread.provider];
  if (chosen && settings.keys[chosen.keyName]) return chosen;
  return ['claude', 'openai', 'grok'].map((id) => proofreaders[id]).find((p) => settings.keys[p.keyName]) || null;
}
