// AssemblyAI async transcription — https://www.assemblyai.com/docs/api-reference/transcripts/submit
import { fileBlob, parseKeyterms, request, sleep } from './http.js';

const BASE = 'https://api.assemblyai.com/v2';

export default {
  id: 'assemblyai',
  name: 'AssemblyAI',
  // Empty = AssemblyAI's current default (best) model.
  model: '',
  keyUrl: 'https://www.assemblyai.com/dashboard/api-keys',
  notes: 'Per-word confidence. Upload, then polls until done.',

  async transcribe({ file, key, model, options, signal }) {
    const headers = { authorization: key };

    const { upload_url } = await request(`${BASE}/upload`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: await fileBlob(file),
      signal,
    });

    const body = { audio_url: upload_url, punctuate: true, format_text: true };
    if (model) body.speech_model = model;
    if (options.language) body.language_code = options.language;
    else body.language_detection = true;
    if (options.diarize) body.speaker_labels = true;
    if (options.fillerWords) body.disfluencies = true;
    const terms = parseKeyterms(options.keyterms, { maxLen: 50 });
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
