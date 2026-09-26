// Shared across jobs: at most four tracks prepare/upload/transcribe at once.
let active = 0;
const waiting = [];
export async function withTrackSlot(signal, fn) {
  signal.throwIfAborted();
  if (active >= 4) await new Promise((resolve, reject) => {
    const entry = { resolve: () => { signal.removeEventListener('abort', abort); resolve(); } };
    const abort = () => { const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); reject(signal.reason); };
    waiting.push(entry);
    signal.addEventListener('abort', abort, { once: true });
  });
  else active++;
  try { signal.throwIfAborted(); return await fn(); }
  finally { const next = waiting.shift(); if (next) next.resolve(); else active--; }
}
