export const badRequest = message => Object.assign(new Error(message), { status: 400 });
export const isId = id => typeof id === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);
export function validateId(id) { if (!isId(id)) throw badRequest('Invalid item ID.'); return id; }
export function object(value, name = 'Request') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${name} must be an object.`);
  return value;
}
export function validateOptions(input = {}) {
  object(input, 'Transcription options');
  const out = {};
  for (const key of ['language', 'keyterms']) if (key in input) {
    if (typeof input[key] !== 'string') throw badRequest(`${key} must be text.`);
    out[key] = input[key];
  }
  for (const key of ['voiceCleanup', 'fillerWords', 'diarize']) if (key in input) {
    if (typeof input[key] !== 'boolean') throw badRequest(`${key} must be on or off.`);
    out[key] = input[key];
  }
  if ('termListIds' in input) {
    if (!Array.isArray(input.termListIds) || input.termListIds.some(id => typeof id !== 'string')) throw badRequest('Choose valid term lists.');
    out.termListIds = [...new Set(input.termListIds)];
  }
  return out;
}
export function validateSetup(input) {
  object(input, 'Project setup');
  if (typeof input.provider !== 'string') throw badRequest('Choose a transcription service.');
  const tracks = object(input.tracks ?? {}, 'Track setup');
  for (const [key, value] of Object.entries(tracks)) {
    if (!/^[a-f\d-]+:\d+$/i.test(key)) throw badRequest('Invalid track selection.');
    object(value, 'Track');
    if (typeof value.on !== 'boolean' || typeof value.label !== 'string') throw badRequest('Each track needs a name and selection.');
  }
  return { provider: input.provider, options: validateOptions(input.options), tracks };
}
export function validateSettings(patch) {
  object(patch, 'Settings');
  const allowed = ['keys', 'models', 'lastOptions', 'proofread', 'confidenceThreshold', 'cue', 'termLists', 'presets', 'lastPresetId'];
  for (const key of Object.keys(patch)) if (!allowed.includes(key)) throw badRequest(`Unknown setting: ${key}`);
  for (const key of ['keys', 'models']) if (key in patch) {
    object(patch[key], key);
    if (Object.values(patch[key]).some(v => typeof v !== 'string')) throw badRequest(`${key} must contain text values.`);
  }
  if ('lastOptions' in patch) validateOptions(patch.lastOptions);
  if ('proofread' in patch) {
    object(patch.proofread, 'Proofreading');
    if ('auto' in patch.proofread && typeof patch.proofread.auto !== 'boolean') throw badRequest('Automatic proofreading must be on or off.');
    if ('provider' in patch.proofread && !['claude','openai','grok'].includes(patch.proofread.provider)) throw badRequest('Choose a valid proofreader.');
    if ('models' in patch.proofread && Object.values(object(patch.proofread.models, 'Models')).some(v => typeof v !== 'string')) throw badRequest('Model names must be text.');
  }
  if ('confidenceThreshold' in patch && (!Number.isFinite(patch.confidenceThreshold) || patch.confidenceThreshold < 0 || patch.confidenceThreshold > 1)) throw badRequest('Confidence must be between 0 and 1.');
  if ('cue' in patch) {
    object(patch.cue, 'Subtitle settings');
    const limits = { maxLineChars: [10,120], maxLineWords: [0,30], maxLines: [1,2], maxDuration: [1,20], pauseSplit: [.2,5], minDuration: [0,5] };
    for (const [key, value] of Object.entries(patch.cue)) {
      const range = limits[key];
      if (!range || !Number.isFinite(value) || value < range[0] || value > range[1] || (['maxLineChars','maxLineWords','maxLines'].includes(key) && !Number.isInteger(value))) throw badRequest(`Invalid subtitle setting: ${key}`);
    }
  }
  for (const field of ['termLists','presets']) if (field in patch) {
    if (!Array.isArray(patch[field])) throw badRequest(`${field} must be a list.`);
    const ids = new Set();
    for (const item of patch[field]) {
      object(item, field);
      if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name !== 'string') throw badRequest(`Invalid ${field} entry.`);
      ids.add(item.id);
      if (field === 'termLists' && (typeof item.terms !== 'string' || ('glossary' in item && typeof item.glossary !== 'string'))) throw badRequest('Term lists must contain text.');
      if (field === 'presets') {
        validateOptions(item);
        if (typeof item.context !== 'string' || typeof item.provider !== 'string' || !Array.isArray(item.tracks) || item.tracks.some(t => !t || typeof t.name !== 'string' || typeof t.on !== 'boolean')) throw badRequest('Invalid preset setup.');
      }
    }
  }
  if ('lastPresetId' in patch && patch.lastPresetId !== null && typeof patch.lastPresetId !== 'string') throw badRequest('Invalid preset.');
}
