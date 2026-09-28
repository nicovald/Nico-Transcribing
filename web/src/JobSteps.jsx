import { formatTime } from './api.js';
import { Icon } from './shared.jsx';

// Where a transcription is right now: prepare audio → send to the service → check for mistakes → review.
// Tracks run in parallel, so more than one step can be active at once.
const active = (x) => x?.status === 'running' || x?.status === 'queued';
const CHECKS = [['memory', 'Learned fixes'], ['glossary', 'Glossary'], ['proofread', 'AI proofread']];

export const showSteps = (job) => active(job) || CHECKS.some(([k]) => active(job[k]));

export default function JobSteps({ job, providerName }) {
  const tracks = job.tracks;
  const transcribing = active(job);
  const finished = tracks.filter((t) => t.status === 'done' || t.status === 'error').length;
  const waiting = tracks.some((t) => t.status === 'queued' || (t.status === 'running' && (!t.step || (t.step.step === 'preparing' && t.step.part === 1))));
  const sending = tracks.filter((t) => t.status === 'running' && t.step?.step === 'sending');
  const runningCheck = CHECKS.find(([k]) => active(job[k]));
  const longest = sending.reduce((a, t) => (t.step.seconds > (a?.step.seconds ?? -1) ? t : a), null);
  const tracksDone = tracks.length > 1 ? `${finished} of ${tracks.length} tracks done` : null;

  const steps = [
    {
      title: 'Prepare audio',
      state: !transcribing || !waiting ? 'done' : 'active',
      detail: transcribing && waiting ? 'Converting each track for upload' : 'Audio ready',
    },
    {
      title: `Transcribe with ${providerName || 'the service'}`,
      state: !transcribing ? 'done' : sending.length ? 'active' : 'todo',
      detail: !transcribing
        ? tracksDone || 'Transcript received'
        : longest
          ? [
            `${formatTime(longest.step.seconds)} so far`,
            longest.step.parts > 1 && `part ${longest.step.part} of ${longest.step.parts}`,
            tracksDone,
          ].filter(Boolean).join(' · ')
          : tracksDone || 'Up next',
    },
    {
      title: 'Check for mistakes',
      state: transcribing ? 'todo' : runningCheck ? 'active' : 'done',
      detail: transcribing
        ? 'Learned fixes, glossary and AI proofread'
        : runningCheck
          ? `${runningCheck[1]}${runningCheck[0] === 'proofread' && job.proofread.progress ? ` · ${Math.round(job.proofread.progress * 100)}%` : '…'}`
          : 'Checks finished',
    },
    { title: 'Ready to review', state: 'todo', detail: 'Lines appear below as each track finishes' },
  ];

  return (
    <ol className="job-steps" aria-label="Transcription progress">
      {steps.map((s, i) => (
        <li key={s.title} className={`job-step ${s.state}`} aria-current={s.state === 'active' ? 'step' : undefined}>
          <span className="job-step-dot">
            {s.state === 'done' ? <Icon name="check" size={14} /> : s.state === 'active' ? <span className="spinner" /> : i + 1}
          </span>
          <span className="job-step-text">
            <b>{s.title}</b>
            <span className="muted small">{s.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// One line per track in the header: what that track is doing right now.
export function trackStepText(t, providerName) {
  if (t.status === 'queued') return 'Waiting for a free slot…';
  if (!t.step) return 'Starting…';
  const part = t.step.parts > 1 ? ` · part ${t.step.part} of ${t.step.parts}` : '';
  if (t.step.step === 'preparing') return `Preparing audio${part}`;
  return `Sending to ${providerName || 'the service'} · ${formatTime(t.step.seconds)}${part}`;
}
