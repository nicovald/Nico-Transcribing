// AssemblyAI async transcription — https://www.assemblyai.com/docs/api-reference/transcripts/submit
import { fileBlob, keytermLimits, limitKeyterms, request, sleep } from './http.js';

const BASE = 'https://api.assemblyai.com/v2';

// Current speech_models IDs (submit schema, checked 2026-10). Leaving the field out uses the
// documented default routing ["universal-3-5-pro", "universal-2"].
// https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit
export const SPEECH_MODELS = ['universal-3-5-pro', 'universal-2'];

// Turn a saved model override into a speech_models list, or [] for default routing.
// Old saved values ("best", "nano", "universal", "slam-1", "default", the deprecated singular
// speech_model aliases) and unknown IDs are dropped, and with none left the default routing is used,
// so an old setting never fails the job after the upload.
export function speechModels(model) {
  const list = String(model || '').split(',').map((m) => m.trim().toLowerCase()).filter(Boolean);
  return [...new Set(list.filter((m) => SPEECH_MODELS.includes(m)))];
}

export default {
  id: 'assemblyai',
  name: 'AssemblyAI',
  // Empty = AssemblyAI's current default (best) model.
  model: '',
  keyUrl: 'https://www.assemblyai.com/dashboard/api-keys',
  notes: 'Per-word confidence. Upload, then polls until done.',
  // keyterms_prompt: 1000 terms on universal-3-5-pro, 200 on universal-2, max 6 words each.
  // The cap must hold for every model a request can reach: an explicit list with universal-2 in it,
  // and the default routing (which can fall back to universal-2) unless the language is English.
  keyterms: (model, options = {}) => {
    const routing = speechModels(model);
    const onlyPro = routing.length ? !routing.includes('universal-2') : /^en(?:[-_]|$)/i.test(options.language || '');
    return { max: onlyPro ? 1000 : 200, maxWords: 6 };
  },

  async transcribe({ file, key, model, options, signal }) {
    const headers = { authorization: key };

    const { upload_url } = await request(`${BASE}/upload`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: await fileBlob(file),
      signal,
    });

    const body = { audio_url: upload_url, punctuate: true, format_text: true };
    // `speech_model` is deprecated; the override is a priority list, e.g. "universal-3-5-pro, universal-2".
    const routing = speechModels(model);
    if (routing.length) body.speech_models = routing;
    if (options.language) body.language_code = options.language;
    else body.language_detection = true;
    if (options.diarize) body.speaker_labels = true;
    if (options.fillerWords) body.disfluencies = true;
    const { terms } = limitKeyterms(options.keyterms, keytermLimits(this, model, options));
    if (terms.length) body.keyterms_prompt = terms;

    const submitted = await request(`${BASE}/transcript`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    let data = submitted;
    while (data.status !== 'completed') {
      if (data.status === 'error') throw new Error(data.error || 'AssemblyAI transcription failed');
      await sleep(3000, signal);
      data = await request(`${BASE}/transcript/${submitted.id}`, { headers, signal });
    }

    // AssemblyAI timestamps are in milliseconds.
    return {
      language: data.language_code ?? null,
      words: (data.words ?? []).map((w) => ({
        text: w.text,
        start: w.start / 1000,
        end: w.end / 1000,
        confidence: w.confidence ?? null,
        speaker: w.speaker ?? null,
      })),
    };
  },
};
