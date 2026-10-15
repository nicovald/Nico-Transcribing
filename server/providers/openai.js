// OpenAI transcription — only whisper-1 returns word timestamps (verbose_json).
// https://developers.openai.com/api/docs/guides/speech-to-text
import { countTokens, fileBlob, FormData, keytermLimits, limitKeyterms, request } from './http.js';

const PREFIX = 'Vocabulary: ';

export default {
  id: 'openai',
  name: 'OpenAI Whisper',
  model: 'whisper-1',
  keyUrl: 'https://platform.openai.com/api-keys',
  notes: '$0.36/hr. 25 MB limit, so audio is sent in 10-minute chunks. Confidence is per sentence, not per word. whisper-1 is deprecated (shuts down Feb 2027).',
  // 25 MB upload cap: 10 min of 48 kbps mono MP3 is ~3.6 MB.
  chunkSeconds: 600,
  codec: 'mp3',
  // Chunks overlap by this much so words cut at a chunk edge are heard whole by one chunk.
  chunkOverlap: 8,
  // Whisper only uses the last 224 tokens of the prompt; stay under 200. Budget the whole "Vocabulary: a, b." string
  // with the conservative counter (each term's +1 covers its comma or the final period).
  keyterms: { maxTokens: 200, overheadTokens: countTokens(PREFIX) },

  async transcribe({ file, key, model, options, signal }) {
    const form = new FormData();
    form.append('model', model || this.model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (options.language) form.append('language', options.language);
    const { terms } = limitKeyterms(options.keyterms, keytermLimits(this, model));
    // Whisper keeps only the END of an over-long prompt, so put the most important terms last.
    if (terms.length) form.append('prompt', `${PREFIX}${[...terms].reverse().join(', ')}.`);
    form.append('file', await fileBlob(file), 'audio.mp3');

    const data = await request('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal,
    });

    // Whisper's words carry no punctuation or confidence; segments have both.
    // Borrow punctuation and a segment-level confidence (exp(avg_logprob)) for each word.
    const segments = data.segments ?? [];
    const words = (data.words ?? []).map((w) => ({ text: w.word, start: w.start, end: w.end, confidence: null, speaker: null }));
    for (const seg of segments) {
      const conf = seg.avg_logprob != null ? Math.exp(seg.avg_logprob) : null;
      const segWords = words.filter((w) => w.start >= seg.start - 0.05 && w.start < seg.end);
      for (const w of segWords) w.confidence = conf;
      restorePunctuation(segWords, seg.text);
    }
    return { language: data.language ?? null, words };
  },
};

// Align segment text tokens to bare words and copy over punctuation/casing.
function restorePunctuation(words, segText) {
  const tokens = segText.trim().split(/\s+/);
  const bare = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  let t = 0;
  for (const w of words) {
    for (let look = t; look < Math.min(tokens.length, t + 3); look++) {
      if (bare(tokens[look]) === bare(w.text)) {
        w.text = tokens[look];
        t = look + 1;
        break;
      }
    }
  }
}
