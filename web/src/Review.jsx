import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatTime } from './api.js';
import { navigate, useApp } from './App.jsx';
import { desktop, Progress, StatusPill } from './shared.jsx';
import usePoll from './usePoll.js';

const TRACK_COLORS = ['#5eb1ff', '#ff8f5e', '#7ee08a', '#d98cff', '#ffd05e', '#5ee0d2', '#ff6b9a', '#b8c0cc'];
const trackColor = (i) => TRACK_COLORS[i % TRACK_COLORS.length];
const running = (x) => x?.status === 'running' || x?.status === 'queued';
const isActive = (j) => running(j) || running(j.proofread) || running(j.compare) || running(j.glossary);

export default function Review({ jobId }) {
  const { providers, settings } = useApp();
  const [job, setJob, refresh, loadError] = usePoll(() => api.get(`/api/jobs/${jobId}`), isActive, 2000, [jobId]);
  const [files, setFiles] = useState([]);
  const [trackFilter, setTrackFilter] = useState('all');
  const [show, setShow] = useState('all'); // all | issues
  const [search, setSearch] = useState('');
  const [labels, setLabels] = useState(true);
  const [compareWith, setCompareWith] = useState('');
  const [playing, setPlaying] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const audio = useRef();
  const stopAt = useRef(null);

  const doneCount = job?.tracks.filter((t) => t.status === 'done').length ?? 0;
  useEffect(() => {
    if (doneCount) api.get(`/api/jobs/${jobId}/srt-files`).then(setFiles);
  }, [jobId, doneCount]);

  const threshold = settings.confidenceThreshold;
  const openSuggestions = useMemo(() => {
    const map = new Map();
    for (const s of job?.suggestions ?? []) {
      if (s.status !== 'open') continue;
      if (!map.has(s.cueId)) map.set(s.cueId, []);
      map.get(s.cueId).push(s);
    }
    return map;
  }, [job]);
  const lowConfidence = (c) => !c.edited && !c.reviewed && c.words?.some((w) => w.confidence != null && w.confidence < threshold);
  const hasIssue = (c) => openSuggestions.has(c.id) || lowConfidence(c);

  const cues = useMemo(() => {
    if (!job) return [];
    const q = search.trim().toLowerCase();
    return [...job.cues]
      .sort((a, b) => a.start - b.start || a.track - b.track)
      .filter((c) => trackFilter === 'all' || c.track === Number(trackFilter))
      .filter((c) => show === 'all' || hasIssue(c))
      .filter((c) => !q || c.text.toLowerCase().includes(q));
  }, [job, trackFilter, show, search, threshold, openSuggestions]);

  if (loadError && !job) return <div className="error">{loadError}</div>;
  if (!job) return <p className="muted">Loading…</p>;

  const provider = providers.transcribers.find((p) => p.id === job.provider);
  const issueCount = job.cues.filter(hasIssue).length;
  const suggestionCount = [...openSuggestions.values()].reduce((n, l) => n + l.length, 0);
  const anyConfidence = job.tracks.some((t) => t.hasConfidence);
  const multiVideo = new Set(job.tracks.map((t) => t.mediaId)).size > 1;
  const trackName = (pos) => {
    const t = job.tracks[pos];
    return t ? (multiVideo ? `${t.mediaName} · ${t.label}` : t.label) : '?';
  };
  const hasProofreadKey = ['anthropic', 'openai', 'grok'].some((k) => settings.keys[k]);

  const act = async (fn) => {
    setActionError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const play = (cue) => {
    const el = audio.current;
    const t = job.tracks[cue.track];
    const src = `/api/media/${t.mediaId}/tracks/${t.index}/audio`;
    if (!el.src.endsWith(src)) el.src = src;
    el.currentTime = Math.max(0, cue.start - 0.15);
    stopAt.current = cue.end + 0.15;
    setPlaying(cue.id);
    el.play();
  };

  const onTime = () => {
    if (stopAt.current != null && audio.current.currentTime >= stopAt.current) {
      audio.current.pause();
      stopAt.current = null;
      setPlaying(null);
    }
  };

  const updateCue = async (cue, patch) => {
    const updated = await api.patch(`/api/jobs/${job.id}/cues/${encodeURIComponent(cue.id)}`, patch);
    setJob((j) => ({ ...j, cues: j.cues.map((c) => (c.id === cue.id ? updated : c)) }));
  };

  const deleteCue = async (cue) => {
    await api.del(`/api/jobs/${job.id}/cues/${encodeURIComponent(cue.id)}`);
    setJob((j) => ({ ...j, cues: j.cues.filter((c) => c.id !== cue.id) }));
  };

  const accept = (s, all) =>
    act(async () => {
      const { cues: changed, suggestions } = await api.post(`/api/jobs/${job.id}/suggestions/${s.id}/accept`, { all });
      const byId = new Map(changed.map((c) => [c.id, c]));
      setJob((j) => ({ ...j, suggestions, cues: j.cues.map((c) => byId.get(c.id) ?? c) }));
    });

  const dismiss = (s) =>
    act(async () => {
      const { suggestions } = await api.post(`/api/jobs/${job.id}/suggestions/${s.id}/dismiss`);
      setJob((j) => ({ ...j, suggestions }));
    });

  const startProofread = () =>
    act(async () => {
      await api.post(`/api/jobs/${job.id}/proofread`);
      refresh();
    });

  const startCompare = () =>
    act(async () => {
      await api.post(`/api/jobs/${job.id}/compare`, { provider: compareWith });
      refresh();
    });

  const rebuild = () =>
    act(async () => {
      if (!window.confirm('Re-splitting the lines throws away your text edits and fix suggestions. Continue?')) return;
      const data = await api.post(`/api/jobs/${job.id}/rebuild`);
      setJob((j) => ({ ...j, ...data }));
    });

  const saveNextToVideos = () =>
    act(async () => {
      const { written } = await api.post(`/api/jobs/${job.id}/export`, { labels });
      setNotice({ text: `Saved ${written.length} file${written.length === 1 ? '' : 's'} next to the video${written.length === 1 ? '' : 's'}.`, path: written[0] });
    });

  const saveToFolder = () =>
    act(async () => {
      const dir = await desktop.pickFolder();
      if (!dir) return;
      const { written } = await api.post(`/api/jobs/${job.id}/export`, { labels, dir });
      setNotice({ text: `Saved ${written.length} file${written.length === 1 ? '' : 's'}.`, path: written[0] });
    });

  const srtUrl = (f) => `/api/jobs/${job.id}/srt?file=${encodeURIComponent(f.key)}${f.merged && !labels ? '&labels=0' : ''}`;
  const canSaveNext = files.some((f) => f.canSaveNextToVideo);

  return (
    <div className="stack">
      <div className="crumbs">
        <a href="#/">Projects</a> › <a href={`#/projects/${job.projectId}`}>{job.project?.name ?? 'Project'}</a> ›
      </div>

      <section className="card">
        <div className="row">
          <div className="grow">
            <h1>{job.project?.name}</h1>
            <div className="muted small">
              {provider?.name} · {job.model} · {new Date(job.createdAt).toLocaleString()}
            </div>
          </div>
          <StatusPill status={job.status} />
        </div>

        <div className="track-status">
          {job.tracks.map((t, pos) => (
            <div key={pos} className="track-status-row">
              <span className="chip" style={{ '--c': trackColor(pos) }}>{trackName(pos)}</span>
              {t.status === 'running' && (t.progress != null ? <Progress value={t.progress} /> : <span className="muted small">Transcribing…</span>)}
              {t.status === 'queued' && <span className="muted small">Waiting…</span>}
              {t.status === 'done' && (
                <span className="muted small">
                  {t.wordCount} words{t.language ? ` · ${t.language}` : ''}
                </span>
              )}
              {t.status === 'error' && <span className="error-text small">{t.error}</span>}
            </div>
          ))}
        </div>

        <div className="row wrap">
          {running(job) && <button onClick={() => act(() => api.post(`/api/jobs/${job.id}/cancel`))}>Cancel</button>}
          {!running(job) && job.tracks.some((t) => t.status !== 'done') && (
            <button onClick={() => act(async () => { await api.post(`/api/jobs/${job.id}/retry`); refresh(); })}>Retry failed tracks</button>
          )}
        </div>
        {actionError && <div className="error">{actionError}</div>}
      </section>

      {doneCount > 0 && (
        <section className="card">
          <h3>Find mistakes</h3>
          <div className="finder">
            <div className="finder-row">
              <div className="grow">
                <strong>Glossary check</strong> <span className="muted small">free · instant</span>
                <div className="muted small">
                  {running(job.glossary)
                    ? 'Checking…'
                    : job.glossary?.status === 'done'
                      ? job.glossary.terms
                        ? `${job.glossary.count} sound-alike${job.glossary.count === 1 ? '' : 's'} found against ${job.glossary.terms.toLocaleString()} terms`
                        : 'No term lists were ticked for this transcript.'
                      : job.glossary?.status === 'error'
                        ? <span className="error-text">{job.glossary.error}</span>
                        : 'Compares every phrase against your term lists by sound ("Couples Stone" → "Cobblestone").'}
                </div>
              </div>
              <button disabled={running(job.glossary)} onClick={() => act(async () => { await api.post(`/api/jobs/${job.id}/glossary`); refresh(); })}>
                {job.glossary ? 'Run again' : 'Check'}
              </button>
            </div>
            <div className="finder-row">
              <div className="grow">
                <strong>AI proofread</strong>
                <div className="muted small">
                  {running(job.proofread)
                    ? `Reading the transcript… ${Math.round((job.proofread.progress || 0) * 100)}%`
                    : job.proofread?.status === 'done'
                      ? `Found ${job.proofread.count} possible mistake${job.proofread.count === 1 ? '' : 's'} (${job.proofread.by})`
                      : job.proofread?.status === 'error'
                        ? <span className="error-text">{job.proofread.error}</span>
                        : hasProofreadKey
                          ? 'Reads the whole transcript and flags misheard words like "Couples Stone" → "Cobblestone".'
                          : 'Add a Claude, OpenAI or xAI key in Settings to use this.'}
                </div>
              </div>
              <button disabled={!hasProofreadKey || running(job.proofread)} onClick={startProofread}>
                {job.proofread ? 'Run again' : 'Proofread'}
              </button>
            </div>
            <div className="finder-row">
              <div className="grow">
                <strong>Compare with another transcriber</strong>
                <div className="muted small">
                  {running(job.compare)
                    ? job.compareJob?.status === 'running'
                      ? `Transcribing with ${providers.transcribers.find((p) => p.id === job.compare.provider)?.name}…`
                      : 'Comparing…'
                    : job.compare?.status === 'done'
                      ? `${job.compare.count} place${job.compare.count === 1 ? '' : 's'} where ${providers.transcribers.find((p) => p.id === job.compare.provider)?.name} heard something different`
                      : job.compare?.status === 'error'
                        ? <span className="error-text">{job.compare.error}</span>
                        : 'Transcribes again with a second service and flags every word they disagree on.'}
                </div>
              </div>
              <select value={compareWith} onChange={(e) => setCompareWith(e.target.value)} disabled={running(job.compare)}>
                <option value="">Pick service…</option>
                {providers.transcribers
                  .filter((p) => p.id !== job.provider && settings.keys[p.id])
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
              <button disabled={!compareWith || running(job.compare)} onClick={startCompare}>Compare</button>
            </div>
          </div>
        </section>
      )}

      {files.length > 0 && (
        <section className="card export">
          <h3>Subtitles</h3>
          {desktop && (
            <div className="row wrap">
              {canSaveNext && <button className="primary" onClick={saveNextToVideos} title="Writes the .srt files into the same folder as each video. Files with the same name are replaced.">Save all next to the videos</button>}
              <button onClick={saveToFolder}>Save all to folder…</button>
            </div>
          )}
          {notice && (
            <div className="ok-box">
              {notice.text}
              {desktop && notice.path && (
                <button className="ghost small-btn" onClick={() => desktop.showItemInFolder(notice.path)}>Show in folder</button>
              )}
            </div>
          )}
          <div className="row wrap">
            {files.map((f) => (
              <a key={f.key} className={`button ${!desktop && f.merged ? 'primary' : ''}`} href={srtUrl(f)} download={f.filename}>
                ⬇ {f.filename}
              </a>
            ))}
          </div>
          {files.some((f) => f.merged) && (
            <label className="inline">
              <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> In merged files, start each line with the track name
            </label>
          )}
        </section>
      )}

      {job.cues.length > 0 && (
        <section>
          <div className="toolbar">
            <select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}>
              <option value="all">All tracks</option>
              {job.tracks.map((t, pos) => (
                <option key={pos} value={pos}>{trackName(pos)}</option>
              ))}
            </select>
            <div className="segmented">
              <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All lines</button>
              <button className={show === 'issues' ? 'on' : ''} onClick={() => setShow('issues')}>
                Needs a look ({issueCount})
              </button>
            </div>
            <input className="grow" placeholder="Search text…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="ghost" onClick={rebuild} title="Re-split lines using the subtitle settings">Re-split lines</button>
          </div>

          <p className="hint">
            Click a time to hear the line. Click text to edit it.
            {suggestionCount > 0 && ` ${suggestionCount} suggested fix${suggestionCount === 1 ? '' : 'es'} below. "Fix all" applies it to every line with the same words.`}
            {!anyConfidence && ` ${provider?.name} doesn't give per-word confidence, so rely on the proofread and compare tools above.`}
          </p>

          <audio ref={audio} onTimeUpdate={onTime} onPause={() => setPlaying(null)} />

          <ul className="cues">
            {cues.map((c) => (
              <CueRow
                key={c.id}
                cue={c}
                label={trackName(c.track)}
                color={trackColor(c.track)}
                multi={job.tracks.length > 1}
                lowConfidence={lowConfidence(c)}
                suggestions={openSuggestions.get(c.id) || []}
                allSuggestions={job.suggestions}
                threshold={threshold}
                playing={playing === c.id}
                onPlay={() => play(c)}
                onSave={(text) => updateCue(c, { text })}
                onReviewed={() => updateCue(c, { reviewed: true })}
                onDelete={() => deleteCue(c)}
                onAccept={accept}
                onDismiss={dismiss}
              />
            ))}
          </ul>
          {!cues.length && <p className="muted">No lines match.</p>}
        </section>
      )}
    </div>
  );
}

function CueRow({ cue, label, color, multi, lowConfidence, suggestions, allSuggestions, threshold, playing, onPlay, onSave, onReviewed, onDelete, onAccept, onDismiss }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cue.text);

  const save = () => {
    setEditing(false);
    if (draft !== cue.text) onSave(draft);
  };

  const flagged = lowConfidence || suggestions.length > 0;
  const sameCount = (s) => allSuggestions.filter((x) => x.status === 'open' && x.from.toLowerCase() === s.from.toLowerCase()).length;

  return (
    <li className={`cue ${flagged ? 'flagged' : ''} ${playing ? 'playing' : ''}`}>
      <div className="cue-main">
        <button className="time" onClick={onPlay} title="Play this line">
          {playing ? '■' : '▶'} {formatTime(cue.start, true)}
        </button>
        {multi && <span className="chip" style={{ '--c': color }}>{label}</span>}
        <div className="cue-text grow">
          {editing ? (
            <textarea
              autoFocus
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
                if (e.key === 'Escape') {
                  setDraft(cue.text);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <div
              className="text"
              onClick={() => {
                setDraft(cue.text);
                setEditing(true);
              }}
            >
              <CueText cue={cue} threshold={threshold} highlights={suggestions.map((s) => s.from)} />
              {cue.edited && <span className="edited" title="Edited">✎</span>}
            </div>
          )}
        </div>
        <div className="cue-actions">
          {lowConfidence && !suggestions.length && (
            <button className="ghost small-btn" title="Looks right, clear the flag" onClick={onReviewed}>✓</button>
          )}
          <button className="ghost small-btn" title="Delete line" onClick={onDelete}>🗑</button>
        </div>
      </div>
      {suggestions.map((s) => {
        const n = sameCount(s);
        return (
          <div key={s.id} className="suggestion">
            <span className={`source source-${s.source}`}>{s.source === 'ai' ? 'AI' : s.sourceLabel}</span>
            <span className="from">{s.from}</span>→<strong className="to">{s.to}</strong>
            {s.reason && s.source === 'ai' && <span className="muted small">{s.reason}</span>}
            {s.verified != null && <span className={`verified ${s.verified >= 0.8 ? 'high' : s.verified < 0.4 ? 'low' : ''}`} title="Jev's confidence that the fix is right">{Math.round(s.verified * 100)}%</span>}
            <span className="grow" />
            <button className="small-btn primary" onClick={() => onAccept(s, false)}>Fix</button>
            {n > 1 && <button className="small-btn" onClick={() => onAccept(s, true)}>Fix all {n}</button>}
            <button className="ghost small-btn" title="Ignore" onClick={() => onDismiss(s)}>✕</button>
          </div>
        );
      })}
    </li>
  );
}

// Cue text with low-confidence words underlined and suggestion phrases highlighted.
function CueText({ cue, threshold, highlights }) {
  const lines = cue.text.split('\n');
  const low = new Set(
    cue.edited ? [] : (cue.words || []).filter((w) => w.confidence != null && w.confidence < threshold).map((w) => w.text.trim()),
  );
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hl = highlights.length ? new RegExp(`(${highlights.map((h) => h.split(/\s+/).map(escape).join('\\s+')).join('|')})`, 'gi') : null;

  const renderLine = (line) => {
    const parts = hl ? line.split(hl) : [line];
    return parts.map((part, i) =>
      hl && i % 2 === 1 ? (
        <mark key={i} className="suspect">{part}</mark>
      ) : (
        part.split(/(\s+)/).map((tok, j) => (low.has(tok) ? <span key={`${i}-${j}`} className="unsure">{tok}</span> : tok))
      ),
    );
  };

  return lines.map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {renderLine(line)}
    </span>
  ));
}
