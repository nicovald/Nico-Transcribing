// Deepgram pre-recorded — https://developers.deepgram.com/docs/pre-recorded-audio
import { fileBlob, keytermLimits, limitKeyterms, request } from './http.js';

export default {
  id: 'deepgram',
  name: 'Deepgram',
  model: 'nova-3',
  keyUrl: 'https://console.deepgram.com/',
  notes: 'Per-word confidence, strong on noisy audio.',
  // nova-3 keyterms share a 500 token budget and going over rejects the request. Our counter is
  // conservative, and an explicit "Keyterm limit exceeded" reply retries once with half the terms.
  // https://developers.deepgram.com/docs/keyterm#key-term-limits
  keyterms: { maxTokens: 450 },

  async transcribe({ file, key, model, options, signal }) {
    const params = new URLSearchParams({ model: model || this.model, smart_format: 'true', punctuate: 'true' });
    if (options.language) params.set('language', options.language);
    else params.set('detect_language', 'true');
    if (options.diarize) params.set('diarize', 'true');
    if (options.fillerWords) params.set('filler_words', 'true');
    const { terms } = limitKeyterms(options.keyterms, keytermLimits(this, model));
    const send = async (list) => {
      const query = new URLSearchParams(params);
      for (const term of list) query.append('keyterm', term);
      return request(`https://api.deepgram.com/v1/listen?${query}`, {
        method: 'POST',
        headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/flac' },
        body: await fileBlob(file),
        signal,
      });
    };

    let data;
    try {
      data = await send(terms);
    } catch (err) {
      // Over the keyterm budget anyway: retry once with the most important half.
      if (terms.length < 2 || signal?.aborted || !isKeytermLimitError(err)) throw err;
      data = await send(terms.slice(0, Math.floor(terms.length / 2)));
    }

    const channel = data.results?.channels?.[0];
    const words = channel?.alternatives?.[0]?.words ?? [];
    return {
      language: channel?.detected_language ?? options.language ?? null,
      words: words.map((w) => ({
        text: w.punctuated_word || w.word || '',
        start: w.start,
        end: w.end,
        confidence: w.confidence ?? null,
        speaker: w.speaker ?? null,
      })),
    };
  },
};

// A 400 that talks about keyterms or tokens (the documented shape isn't pinned down, so stay loose),
// or any message that names the keyterm limit.
export const isKeytermLimitError = (err) => {
  const msg = err?.message || '';
  return (err?.status === 400 && /keyterm|token/i.test(msg)) || (/keyterm/i.test(msg) && /limit|exceed|too many/i.test(msg));
};
