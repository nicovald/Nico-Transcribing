// ElevenLabs Scribe — https://elevenlabs.io/docs/api-reference/speech-to-text/convert
import { fileBlob, FormData, keytermLimits, limitKeyterms, request } from './http.js';

export default {
  id: 'elevenlabs',
  name: 'ElevenLabs Scribe',
  model: 'scribe_v2',
  keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
  notes: 'About $0.22/hr. Per-word confidence, very accurate.',
  // Up to 1000 keyterms, each under 50 characters, at most 5 words, none of < > { } [ ] \.
  keyterms: { max: 1000, maxChars: 49, maxWords: 5, banned: /[<>{}[\]\\]/ },

  async transcribe({ file, key, model, options, signal }) {
    const form = new FormData();
    form.append('model_id', model || this.model);
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'false');
    if (options.language) form.append('language_code', options.language);
    if (options.diarize) form.append('diarize', 'true');
    for (const term of limitKeyterms(options.keyterms, keytermLimits(this, model)).terms) form.append('keyterms', term);
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
        // Scribe can return words with null start/end; those are dropped (or given a neighbor's time) in jobs.js.
        .filter((w) => w.type === 'word' || w.type == null)
        .map((w) => ({
          text: w.text,
          start: w.start ?? null,
          end: w.end ?? null,
          // logprob is <= 0; exp() turns it into a 0..1 probability.
          confidence: w.logprob != null ? Math.exp(w.logprob) : null,
          speaker: speakerNum(w.speaker_id),
        })),
    };
  },
};
