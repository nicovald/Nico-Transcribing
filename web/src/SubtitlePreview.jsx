import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCues } from '../../server/srt.js';

// A short sample clip, timed like real speech: two sentences, a run-on sentence and pauses,
// so every subtitle setting visibly changes something.
const SCRIPT = [
  { at: 0.0, text: 'Okay so we need way more cobblestone for the wall, like at least three full stacks.' },
  { at: 1.3, text: 'Wait.' },
  { at: 0.4, text: 'Crainer, did you grab the redstone from the chest before the creeper blew up the whole base?' },
  { at: 1.1, text: 'No, I thought you had it!' },
  { at: 0.3, text: "Alright alright, let's just go mining and pretend this never happened." },
];
// Words the transcriber was unsure about, to show the underline threshold.
const CONFIDENCE = { cobblestone: 0.45, crainer: 0.38, redstone: 0.62, creeper: 0.74, mining: 0.82 };

function sampleWords() {
  const words = [];
  let t = 0;
  for (const seg of SCRIPT) {
    t += seg.at;
    for (const text of seg.text.split(' ')) {
      const length = 0.16 + text.replace(/\W/g, '').length * 0.035;
      const bare = text.toLowerCase().replace(/[^a-z]/g, '');
      words.push({ text, start: t, end: t + length, confidence: CONFIDENCE[bare] ?? 0.96, speaker: null });
      t += length + 0.07;
    }
  }
  return words;
}
const WORDS = sampleWords();
const CLIP_END = WORDS.at(-1).end + 1.2;
const stamp = (s) => `0:${s.toFixed(1).padStart(4, '0')}`;

export default function SubtitlePreview({ cue, threshold }) {
  const cues = useMemo(() => buildCues(WORDS, cue), [cue.maxLineChars, cue.maxLineWords, cue.maxLines, cue.maxDuration, cue.pauseSplit, cue.minDuration]);
  const [t, setT] = useState(0);
  const root = useRef();

  // Plays the clip on a loop, only while the preview is actually on screen.
  useEffect(() => {
    const timer = setInterval(() => {
      if (root.current?.offsetParent == null) return;
      setT((x) => (x + 0.1 >= CLIP_END ? 0 : x + 0.1));
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const current = cues.find((c) => t >= c.start && t < c.end);
  const longest = Math.max(...cues.flatMap((c) => c.text.split('\n').map((l) => l.length)));

  return (
    <div className="sub-preview" ref={root}>
      <div className="stack-tight">
        <div className="frame" aria-label="Preview of subtitles on a video">
          <span className="frame-time">{stamp(t)}</span>
          {current && <div className="frame-caption">{current.text.split('\n').map((line, i) => <span key={i}>{line}</span>)}</div>}
          <div className="frame-bar"><div style={{ width: `${(t / CLIP_END) * 100}%` }} /></div>
        </div>
        <p className="muted small">
          {cues.length} subtitles for this {Math.round(CLIP_END)}-second clip · longest line {longest} characters
        </p>
        <p className="conf-demo">
          {WORDS.slice(0, 16).map((w, i) => (
            <span key={i} className={w.confidence < threshold ? 'low-conf' : ''}>{w.text} </span>
          ))}
        </p>
        <span className="hint">Underlined: words below {Math.round(threshold * 100)}% confidence.</span>
      </div>
      <ol className="preview-cues">
        {cues.map((c) => (
          <li key={c.id} className={c === current ? 'on' : ''}>
            <span className="preview-time">{stamp(c.start)} → {stamp(c.end)} <em>{(c.end - c.start).toFixed(1)}s</em></span>
            <span className="preview-text">{c.text.split('\n').map((line, i) => <span key={i}>{line} <small>{line.length}</small></span>)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
