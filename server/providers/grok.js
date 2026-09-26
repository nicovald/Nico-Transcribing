// xAI Grok Voice Transcribe — https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
import { fileBlob, FormData, parseKeyterms, request } from './http.js';

export default {
  id: 'grok',
  name: 'Grok (xAI)',
  model: 'grok-voice-transcribe-2.0',
  keyUrl: 'https://console.x.ai/',
  notes: '$0.10/hr. Word timestamps + speakers, but no per-word confidence scores.',

  async transcribe({ file, key, model, options, signal }) {
    const form = new FormData();
    form.append('model', model || this.model);
    // Grok only allows number/date formatting when the language is given.
    if (options.language) {
      form.append('language', options.language);
      form.append('format', 'true');
    }
    if (options.diarize) form.append('diarize', 'true');
    if (options.fillerWords) form.append('filler_words', 'true');
    for (const term of parseKeyterms(options.keyterms)) form.append('keyterm', term);
    // xAI requires `file` to be the last multipart field.
    form.append('file', await fileBlob(file), 'audio.flac');

    const data = await request('https://api.x.ai/v1/stt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal,
    });

    const words = data.words ?? data.channels?.[0]?.words ?? [];
    return {
      language: data.language ?? null,
      words: words.map((w) => ({
        text: w.text ?? w.word ?? '',
        start: w.start,
        end: w.end,
        confidence: w.confidence ?? null,
        speaker: w.speaker ?? null,
      })),
    };
  },
};
