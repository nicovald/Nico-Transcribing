// Text, suggestions and undo are committed together. Legacy files stay as backups.
import path from 'node:path';
import * as store from './store.js';
const file = id => path.join(store.jobDir(id), 'transcript.json');
export function readTranscript(id) {
  return store.readJson(file(id), null) ?? {
    revision: 0,
    cues: store.readJson(path.join(store.jobDir(id), 'cues.json'), []),
    suggestions: store.readJson(path.join(store.jobDir(id), 'suggestions.json'), []),
    history: store.readJson(path.join(store.jobDir(id), 'history.json'), []),
  };
}
export function updateTranscript(id, mutate, label) {
  if (!store.getJob(id)) throw Object.assign(new Error('This transcript was removed.'), { status: 404 });
  const state = readTranscript(id), before = label ? structuredClone(state) : null;
  const result = mutate(state);
  if (before) {
    const changes = field => {
      const old = new Map(before[field].map(item => [item.id, item]));
      const next = new Map(state[field].map(item => [item.id, item]));
      return [...new Set([...old.keys(), ...next.keys()])]
        .filter(key => JSON.stringify(old.get(key)) !== JSON.stringify(next.get(key)))
        .map(key => ({ id: key, before: old.get(key) ?? null }));
    };
    const cues = changes('cues'), suggestions = changes('suggestions');
    if (cues.length || suggestions.length) {
      state.history.push({ label, at: new Date().toISOString(), changes: { cues, suggestions } });
      state.history = state.history.slice(-100);
    }
  }
  state.revision = (state.revision || 0) + 1;
  store.writeJson(file(id), state);
  return { state, result };
}
export const summary = id => {
  const { history } = readTranscript(id);
  return { undoCount: history.length, undoLabel: history.at(-1)?.label ?? null };
};
export function undo(id) {
  if (!readTranscript(id).history.length) return null;
  const { state, result: label } = updateTranscript(id, state => {
    const entry = state.history.pop();
    const changes = entry.changes ?? {
      cues: (entry.cues || []).map(before => ({ id: before.id, before })),
      suggestions: (entry.suggestions || []).map(before => ({ id: before.id, before })),
    };
    for (const field of ['cues', 'suggestions']) {
      const map = new Map(state[field].map(item => [item.id, item]));
      for (const change of changes[field]) {
        if (change.before) map.set(change.id, change.before);
        else map.delete(change.id);
      }
      state[field] = [...map.values()];
    }
    return entry.label;
  });
  return { label, cues: state.cues, suggestions: state.suggestions, ...summary(id) };
}
