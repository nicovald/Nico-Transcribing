// Turn normalized word timings into subtitle cues, and cues into SRT text.
//
// A word is { text, start, end, confidence: number|null, speaker: number|null }.
// A cue is { id, track, start, end, text, words, edited }.

const SENTENCE_END = /[.!?…]["')\]]*$/;
const CLAUSE_END = /[,;:—–-]["')\]]*$/;

// A line fits when it is within the character limit and, if set, the word limit (0 = no limit).
const wordCount = (s) => s.split(' ').filter(Boolean).length;
const lineFits = (s, maxLineChars, maxLineWords) => s.length <= maxLineChars && (!maxLineWords || wordCount(s) <= maxLineWords);

function lineSplit(text, maxLineChars, maxLines, maxLineWords = 0) {
  if (maxLines < 2 || lineFits(text, maxLineChars, maxLineWords)) return text;
  // Break at the space closest to the middle so the two lines are balanced,
  // preferring breaks where both lines fit the limits.
  const mid = text.length / 2;
  const fits = (i) => lineFits(text.slice(0, i), maxLineChars, maxLineWords) && lineFits(text.slice(i + 1), maxLineChars, maxLineWords);
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ' ') continue;
    if (best === -1 || (fits(i) && !fits(best)) || (fits(i) === fits(best) && Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return best === -1 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

// True when text can be wrapped into at most maxLines lines within the limits.
function fitsLines(text, maxLineChars, maxLines, maxLineWords = 0) {
  if (lineFits(text, maxLineChars, maxLineWords)) return true;
  if (maxLines < 2) return false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' && lineFits(text.slice(0, i), maxLineChars, maxLineWords) && lineFits(text.slice(i + 1), maxLineChars, maxLineWords)) return true;
  }
  return false;
}

export function joinWords(words) {
  return words
    .map((w) => w.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?;:…%])/g, '$1');
}

export function buildCues(words, opts, track = 0) {
  const { maxLineChars = 42, maxLineWords = 0, maxLines = 2, maxDuration = 6, pauseSplit = 0.8, minDuration = 0.8 } = opts;
  const maxChars = maxLineChars * maxLines;
  const cues = [];
  let current = [];

  const flush = () => {
    if (current.length) cues.push(current);
    current = [];
  };

  for (const word of words) {
    if (!word.text?.trim()) continue;
    if (current.length) {
      const first = current[0];
      const last = current[current.length - 1];
      const nextText = joinWords([...current, word]);
      const lastText = last.text.trim();
      const curLen = joinWords(current).length;
      if (
        !fitsLines(nextText, maxLineChars, maxLines, maxLineWords) ||
        word.end - first.start > maxDuration ||
        word.start - last.end > pauseSplit ||
        (word.speaker != null && last.speaker != null && word.speaker !== last.speaker) ||
        (SENTENCE_END.test(lastText) && curLen >= 12) ||
        (CLAUSE_END.test(lastText) && curLen >= maxChars * 0.6)
      ) {
        flush();
      }
    }
    current.push(word);
  }
  flush();

  return cues.map((ws, i) => {
    const next = cues[i + 1];
    const start = ws[0].start;
    let end = ws[ws.length - 1].end;
    // Keep short cues on screen long enough to read, without running into the next cue.
    if (end - start < minDuration) end = Math.min(start + minDuration, next ? next[0].start : Infinity);
    return {
      id: `${track}-${i}`,
      track,
      start: round(start),
      end: round(Math.max(end, start + 0.1)),
      text: lineSplit(joinWords(ws), maxLineChars, maxLines, maxLineWords),
      words: ws,
      speaker: ws[0].speaker ?? null,
      edited: false,
    };
  });
}

const round = (n) => Math.round(n * 1000) / 1000;

export function formatTimestamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

// cues: array of cues; label(cue) -> optional prefix like "Host"
export function toSrt(cues, { label } = {}) {
  return (
    [...cues]
      .filter((c) => c.text.trim())
      .sort((a, b) => a.start - b.start || a.track - b.track)
      .map((c, i) => {
        const prefix = label?.(c);
        const text = prefix ? `[${prefix}] ${c.text}` : c.text;
        return `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${text.trim()}\n`;
      })
      .join('\n')
  );
}
