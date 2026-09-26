// Provider registry. To add a provider, create a module exporting
// { id, name, model, keyUrl, notes, transcribe({ file, key, model, options, signal }) }
// that resolves to { language, words: [{ text, start, end, confidence, speaker }] } (seconds),
// then add it here. Optional: chunkSeconds + codec for size-limited APIs.
import assemblyai from './assemblyai.js';
import deepgram from './deepgram.js';
import elevenlabs from './elevenlabs.js';
import grok from './grok.js';
import openai from './openai.js';

export const providers = Object.fromEntries([grok, deepgram, assemblyai, elevenlabs, openai].map((p) => [p.id, p]));

export const providerList = () =>
  Object.values(providers).map(({ id, name, model, keyUrl, notes }) => ({ id, name, model, keyUrl, notes }));
