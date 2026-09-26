// Deepgram pre-recorded — https://developers.deepgram.com/docs/pre-recorded-audio
import { fileBlob, parseKeyterms, request } from './http.js';

export default {
  id: 'deepgram',
  name: 'Deepgram',
  model: 'nova-3',
  keyUrl: 'https://console.deepgram.com/',
  notes: 'Per-word confidence, strong on noisy audio.',

  async transcribe({ file, key, model, options, signal }) {
    const params = new URLSearchParams({ model: model || this.model, smart_format: 'true', punctuate: 'true' });
    if (options.language) params.set('language', options.language);
    else params.set('detect_language', 'true');
    if (options.diarize) params.set('diarize', 'true');
    if (options.fillerWords) params.set('filler_words', 'true');
    for (const term of parseKeyterms(options.keyterms)) params.append('keyterm', term);

    const data = await request(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/flac' },
      body: await fileBlob(file),
      signal,
    });

    const channel = data.results?.channels?.[0];
    const words = channel?.alternatives?.[0]?.words ?? [];
    return {
      language: channel?.detected_language ?? options.language ?? null,
      words: words.map((w) => ({
        text: w.punctuated_word ?? w.word,
        start: w.start,
        end: w.end,
        confidence: w.confidence ?? null,
        speaker: w.speaker ?? null,
      })),
    };
  },
};
