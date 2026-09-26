// ElevenLabs Scribe — https://elevenlabs.io/docs/api-reference/speech-to-text/convert
import { fileBlob, FormData, parseKeyterms, request } from './http.js';

export default {
  id: 'elevenlabs',
  name: 'ElevenLabs Scribe',
  model: 'scribe_v2',
  keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
  notes: 'Per-word confidence, very accurate.',

  async transcribe({ file, key, model, options, signal }) {
    const form = new FormData();
    form.append('model_id', model || this.model);
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'false');
    if (options.language) form.append('language_code', options.language);
    if (options.diarize) form.append('diarize', 'true');
    for (const term of parseKeyterms(options.keyterms)) form.append('keyterms', term);
    form.append('file', await fileBlob(file), 'audio.flac');

    const data = await request('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
      signal,
    });

    const speakerIds = new Map();
    const speakerNum = (id) => {
      if (id == null) return null;
      if (!speakerIds.has(id)) speakerIds.set(id, speakerIds.size);
      return speakerIds.get(id);
    };

    return {
      language: data.language_code ?? null,
      words: (data.words ?? [])
        .filter((w) => w.type === 'word' || w.type == null)
        .map((w) => ({
          text: w.text,
          start: w.start,
          end: w.end,
          // logprob is <= 0; exp() turns it into a 0..1 probability.
          confidence: w.logprob != null ? Math.exp(w.logprob) : null,
          speaker: speakerNum(w.speaker_id),
        })),
    };
  },
};
