// Undo history for transcript edits. Each entry stores only what the edit touched:
// the previous versions of changed/deleted cues and, if suggestions changed, the old list.
import fs from 'node:fs';
import path from 'node:path';
import { readCues, readSuggestions, writeCues, writeSuggestions } from './jobs.js';
import * as store from './store.js';

const MAX_ENTRIES = 100;
const historyPath = (jobId) => path.join(store.jobDir(jobId), 'history.json');
const read = (jobId) => store.readJson(historyPath(jobId), []);
const write = (jobId, h) => fs.writeFileSync(historyPath(jobId), JSON.stringify(h));

const copy = (x) => structuredClone(x);

// Call before mutating. `cueIds`: cues about to change or be deleted.
// `withSuggestions`: also snapshot the suggestion list.
export function record(jobId, label, { cueIds = [], withSuggestions = false } = {}) {
  const ids = new Set(cueIds);
  const entry = {
    label,
    at: new Date().toISOString(),
    cues: readCues(jobId).filter((c) => ids.has(c.id)).map(copy),
    suggestions: withSuggestions ? readSuggestions(jobId) : null,
  };
  const h = read(jobId);
  h.push(entry);
  write(jobId, h.slice(-MAX_ENTRIES));
}

export function undo(jobId) {
  const h = read(jobId);
  const entry = h.pop();
  if (!entry) return null;
  const cues = readCues(jobId);
  const byId = new Map(cues.map((c, i) => [c.id, i]));
  for (const prev of entry.cues) {
    if (byId.has(prev.id)) cues[byId.get(prev.id)] = prev;
    else cues.push(prev); // it was deleted; put it back
  }
  writeCues(jobId, cues);
  if (entry.suggestions) writeSuggestions(jobId, entry.suggestions);
  write(jobId, h);
  return { label: entry.label, cues, suggestions: readSuggestions(jobId), ...summary(jobId) };
}

export function summary(jobId) {
  const h = read(jobId);
  return { undoCount: h.length, undoLabel: h.at(-1)?.label ?? null };
}

// Re-splitting lines replaces every cue, so older undo steps no longer apply.
export const clear = (jobId) => write(jobId, []);
