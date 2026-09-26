import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatTime } from './api.js';
import { useApp } from './App.jsx';
import { desktop, Icon, Progress, StatusPill } from './shared.jsx';
import usePoll from './usePoll.js';

const TRACK_COLORS = ['#7aa2f7', '#e0a36b', '#8cc98f', '#c49bea', '#d9c36a', '#6cc7c0', '#e58aa6', '#a3a9b3'];
const trackColor = (i) => TRACK_COLORS[i % TRACK_COLORS.length];
const running = (x) => x?.status === 'running' || x?.status === 'queued';
const isActive = (j) => running(j) || running(j.proofread) || running(j.compare) || running(j.glossary);
// Jev strongly disagreeing (<15%) almost always means a junk suggestion; tuck those away.
const UNLIKELY = 0.15;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// "1:14.9" / "1:02:03.4" for the timecode column.
const timecode = (sec) => formatTime(sec, true);

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
  const [toast, setToast] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [showUnlikely, setShowUnlikely] = useState(false);
  const [pickedLists, setPickedLists] = useState(null);
  const audio = useRef();
  const stopAt = useRef(null);
  const toastTimer = useRef();

  const doneCount = job?.tracks.filter((t) => t.status === 'done').length ?? 0;
  useEffect(() => {
    if (doneCount) api.get(`/api/jobs/${jobId}/srt-files`).then(setFiles);
  }, [jobId, doneCount]);

  const threshold = settings.confidenceThreshold;
  // Term lists for the glossary check; starts from what was ticked when transcribing.
  const checkLists = pickedLists ?? job?.options.termListIds ?? [];
  const toggleCheckList = (id) => setPickedLists(checkLists.includes(id) ? checkLists.filter((x) => x !== id) : [...checkLists, id]);

  const unlikely = (s) => s.verified != null && s.verified < UNLIKELY;
  const unlikelyCount = (job?.suggestions ?? []).filter((s) => s.status === 'open' && unlikely(s)).length;
  const openSuggestions = useMemo(() => {
    const map = new Map();
    for (const s of job?.suggestions ?? []) {
      if (s.status !== 'open' || (!showUnlikely && unlikely(s))) continue;
      if (!map.has(s.cueId)) map.set(s.cueId, []);
      map.get(s.cueId).push(s);
    }
    return map;
  }, [job, showUnlikely]);
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

  const say = (text) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  const act = async (fn) => {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const undo = useCallback(
    () =>
      act(async () => {
        const r = await api.post(`/api/jobs/${jobId}/undo`);
        setJob((j) => ({ ...j, cues: r.cues, suggestions: r.suggestions, undoCount: r.undoCount, undoLabel: r.undoLabel }));
        say(`Undid: ${r.label}`);
      }),
    [jobId],
  );

  // Ctrl+Z undoes transcript edits (but not while typing in a box).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

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
  const words = job.tracks.reduce((n, t) => n + (t.wordCount || 0), 0);
  const withUndo = (r) => setJob((j) => ({ ...j, undoCount: r.undoCount, undoLabel: r.undoLabel }));

  const play = (cue) => {
    const el = audio.current;
    if (playing === cue.id) {
      el.pause();
      return;
    }
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

  const updateCue = (cue, patch, message) =>
    act(async () => {
      const r = await api.patch(`/api/jobs/${job.id}/cues/${encodeURIComponent(cue.id)}`, patch);
      setJob((j) => ({ ...j, cues: j.cues.map((c) => (c.id === cue.id ? r.cue : c)) }));
      withUndo(r);
      say(message);
    });

  const deleteCue = (cue) =>
    act(async () => {
      const r = await api.del(`/api/jobs/${job.id}/cues/${encodeURIComponent(cue.id)}`);
      setJob((j) => ({ ...j, cues: j.cues.filter((c) => c.id !== cue.id) }));
      withUndo(r);
      say('Deleted line');
    });

  const accept = (s, all, to) =>
    act(async () => {
      const r = await api.post(`/api/jobs/${job.id}/suggestions/${s.id}/accept`, { all, to });
      const byId = new Map(r.cues.map((c) => [c.id, c]));
      setJob((j) => ({ ...j, suggestions: r.suggestions, cues: j.cues.map((c) => byId.get(c.id) ?? c) }));
      withUndo(r);
      say(`Changed "${s.from}" to "${to || s.to}"${r.cues.length > 1 ? ` in ${r.cues.length} lines` : ''}`);
    });

  const dismiss = (s) =>
    act(async () => {
      const r = await api.post(`/api/jobs/${job.id}/suggestions/${s.id}/dismiss`);
      setJob((j) => ({ ...j, suggestions: r.suggestions }));
      withUndo(r);
      say(`Ignored "${s.from}"`);
    });

  const rebuild = () =>
    act(async () => {
      if (!window.confirm('Re-splitting the lines throws away your text edits, fix suggestions and undo history. Continue?')) return;
      const data = await api.post(`/api/jobs/${job.id}/rebuild`);
      setJob((j) => ({ ...j, ...data }));
    });

  const exportTo = (dir) =>
    act(async () => {
      const { written } = await api.post(`/api/jobs/${job.id}/export`, { labels, dir });
      setNotice({ text: `Saved ${plural(written.length, 'file')}`, path: written[0] });
    });

  const saveToFolder = async () => {
    const dir = await desktop.pickFolder();
    if (dir) exportTo(dir);
  };

  const srtUrl = (f) => `/api/jobs/${job.id}/srt?file=${encodeURIComponent(f.key)}${f.merged && !labels ? '&labels=0' : ''}`;
  const canSaveNext = files.some((f) => f.canSaveNextToVideo);
  const checking = job.status === 'done' && (running(job.glossary) || running(job.proofread) || running(job.compare));

  return (
    <div className="review">
      <header className="page-head">
        <div className="crumbs">
          <a href="#/">Projects</a>
          <span>/</span>
          <a href={`#/projects/${job.projectId}`}>{job.project?.name ?? 'Project'}</a>
        </div>
        <div className="row">
          <h1 className="grow">{job.project?.name}</h1>
          <StatusPill status={job.status} />
        </div>
        <div className="meta">
          {provider?.name} · {job.model} · {new Date(job.createdAt).toLocaleString()}
          {words > 0 && ` · ${words.toLocaleString()} words`}
        </div>
        <div className="track-list">
          {job.tracks.map((t, pos) => (
            <div key={pos} className="track-line">
              <span className="dot" style={{ background: trackColor(pos) }} />
              <span>{trackName(pos)}</span>
              {t.status === 'running' && (t.progress != null ? <Progress value={t.progress} /> : <span className="muted">transcribing…</span>)}
              {t.status === 'queued' && <span className="muted">waiting…</span>}
              {t.status === 'done' && <span className="muted">{t.wordCount.toLocaleString()} words{t.language ? ` · ${t.language}` : ''}</span>}
              {t.status === 'error' && <span className="error-text">{t.error}</span>}
            </div>
          ))}
        </div>
        {(running(job) || job.tracks.some((t) => t.status === 'error')) && (
          <div className="row">
            {running(job) && <button onClick={() => act(() => api.post(`/api/jobs/${job.id}/cancel`))}>Cancel</button>}
            {!running(job) && (
              <button onClick={() => act(async () => { await api.post(`/api/jobs/${job.id}/retry`); refresh(); })}>Retry failed tracks</button>
            )}
          </div>
        )}
      </header>

      {actionError && <div className="error">{actionError}</div>}

      {checking && (
        <div className="strip">
          <span className="spinner" /> Checking for mistakes. Suggestions appear below as they come in, usually within a minute.
        </div>
      )}
      {!checking && suggestionCount > 0 && show === 'all' && (
        <div className="strip strip-accent">
          <span className="grow">
            {plural(suggestionCount, 'possible mistake')} to review.
          </span>
          <button className="primary" onClick={() => setShow('issues')}>Review</button>
        </div>
      )}

      <div className="review-layout">
        <section className="transcript">
          {job.cues.length > 0 ? (
            <>
              <div className="toolbar">
                <div className="segmented">
                  <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>
                    All <span className="count">{job.cues.length}</span>
                  </button>
                  <button className={show === 'issues' ? 'on' : ''} onClick={() => setShow('issues')}>
                    Needs a look <span className="count">{issueCount}</span>
                  </button>
                </div>
                {job.tracks.length > 1 && (
                  <select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}>
                    <option value="all">All tracks</option>
                    {job.tracks.map((t, pos) => (
                      <option key={pos} value={pos}>{trackName(pos)}</option>
                    ))}
                  </select>
                )}
                <input className="grow search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
                <button className="ghost" disabled={!job.undoCount} onClick={undo} title={job.undoLabel ? `Undo: ${job.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}>
                  <Icon name="undo" /> Undo
                </button>
              </div>

              <div className="list-hint">
                Click a timecode to play the line, click text to edit it.
                {!anyConfidence && ` ${provider?.name} has no per-word confidence, so flags come from the checks on the right.`}
                {unlikelyCount > 0 && (
                  <>
                    {' '}
                    <button className="link-btn" onClick={() => setShowUnlikely(!showUnlikely)}>
                      {showUnlikely ? 'Hide' : 'Show'} {plural(unlikelyCount, 'unlikely suggestion')}
                    </button>
                  </>
                )}
              </div>

              <audio ref={audio} onTimeUpdate={onTime} onPause={() => setPlaying(null)} />

              <ul className="cues">
                {cues.map((c) => (
                  <CueRow
                    key={c.id}
                    cue={c}
                    label={job.tracks.length > 1 ? trackName(c.track) : null}
                    color={trackColor(c.track)}
                    lowConfidence={lowConfidence(c)}
                    suggestions={openSuggestions.get(c.id) || []}
                    allSuggestions={job.suggestions}
                    threshold={threshold}
                    playing={playing === c.id}
                    onPlay={() => play(c)}
                    onSave={(text) => updateCue(c, { text }, 'Edited line')}
                    onReviewed={() => updateCue(c, { reviewed: true }, 'Marked as checked')}
                    onDelete={() => deleteCue(c)}
                    onAccept={accept}
                    onDismiss={dismiss}
                  />
                ))}
              </ul>
              {!cues.length && <p className="empty">{show === 'issues' ? 'Nothing left to look at.' : 'No lines match.'}</p>}
            </>
          ) : (
            <p className="empty">{running(job) ? 'Transcribing… lines appear here when each track finishes.' : 'No lines.'}</p>
          )}
        </section>

        {doneCount > 0 && (
          <aside className="side">
            {files.length > 0 && (
              <div className="side-section">
                <h3>Export</h3>
                {desktop && (
                  <div className="stack-tight">
                    {canSaveNext && (
                      <button className="primary" onClick={() => exportTo()} title="Writes the .srt files into each video's folder. Files with the same name are replaced.">
                        Save next to the videos
                      </button>
                    )}
                    <button onClick={saveToFolder}>
                      <Icon name="folder" /> Save to folder…
                    </button>
                  </div>
                )}
                {notice && (
                  <div className="saved">
                    <Icon name="check" /> {notice.text}
                    {desktop && notice.path && (
                      <button className="link-btn" onClick={() => desktop.showItemInFolder(notice.path)}>Show</button>
                    )}
                  </div>
                )}
                <ul className="file-list">
                  {files.map((f) => (
                    <li key={f.key}>
                      <a href={srtUrl(f)} download={f.filename} title="Download">
                        <Icon name="download" />
                        <span>{f.filename}</span>
                      </a>
                    </li>
                  ))}
                </ul>
                {files.some((f) => f.merged) && (
                  <label className="check">
                    <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Track names in merged files
                  </label>
                )}
              </div>
            )}

            <div className="side-section">
              <h3>Checks</h3>

              <div className="check-item">
                <div className="check-head">
                  <span>Glossary</span>
                  <button
                    className="ghost small"
                    disabled={running(job.glossary) || !checkLists.length}
                    onClick={() => act(async () => { await api.post(`/api/jobs/${job.id}/glossary`, { termListIds: checkLists }); refresh(); })}
                  >
                    {job.glossary ? 'Run again' : 'Run'}
                  </button>
                </div>
                <p>
                  {running(job.glossary)
                    ? 'Checking…'
                    : job.glossary?.status === 'done'
                      ? job.glossary.terms
                        ? `${plural(job.glossary.count, 'sound-alike')} against ${job.glossary.terms.toLocaleString()} terms.`
                        : 'No term lists were ticked. Pick some and run again.'
                      : job.glossary?.status === 'error'
                        ? <span className="error-text">{job.glossary.error}</span>
                        : 'Matches phrases against your term lists by sound. Free.'}
                </p>
                {settings.termLists.length > 0 && (
                  <div className="toggles">
                    {settings.termLists.map((l) => (
                      <label key={l.id} className="check">
                        <input type="checkbox" checked={checkLists.includes(l.id)} onChange={() => toggleCheckList(l.id)} /> {l.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="check-item">
                <div className="check-head">
                  <span>AI proofread</span>
                  <button className="ghost small" disabled={!hasProofreadKey || running(job.proofread)} onClick={() => act(async () => { await api.post(`/api/jobs/${job.id}/proofread`); refresh(); })}>
                    {job.proofread ? 'Run again' : 'Run'}
                  </button>
                </div>
                <p>
                  {running(job.proofread)
                    ? `Reading… ${Math.round((job.proofread.progress || 0) * 100)}%`
                    : job.proofread?.status === 'done'
                      ? `${plural(job.proofread.count, 'suggestion')} · ${job.proofread.by}`
                      : job.proofread?.status === 'error'
                        ? <span className="error-text">{job.proofread.error}</span>
                        : hasProofreadKey
                          ? 'Reads the transcript for misheard words.'
                          : 'Needs a Claude, OpenAI or xAI key in Settings.'}
                </p>
              </div>

              <div className="check-item">
                <div className="check-head">
                  <span>Second opinion</span>
                </div>
                <p>
                  {running(job.compare)
                    ? job.compareJob?.status === 'running'
                      ? `Transcribing with ${providers.transcribers.find((p) => p.id === job.compare.provider)?.name}…`
                      : 'Comparing…'
                    : job.compare?.status === 'done'
                      ? `${plural(job.compare.count, 'place')} where ${providers.transcribers.find((p) => p.id === job.compare.provider)?.name} heard something else.`
                      : job.compare?.status === 'error'
                        ? <span className="error-text">{job.compare.error}</span>
                        : 'Transcribe again with another service and flag disagreements.'}
                </p>
                <div className="row">
                  <select className="grow" value={compareWith} onChange={(e) => setCompareWith(e.target.value)} disabled={running(job.compare)}>
                    <option value="">Service…</option>
                    {providers.transcribers
                      .filter((p) => p.id !== job.provider && settings.keys[p.id])
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                  </select>
                  <button disabled={!compareWith || running(job.compare)} onClick={() => act(async () => { await api.post(`/api/jobs/${job.id}/compare`, { provider: compareWith }); refresh(); })}>
                    Run
                  </button>
                </div>
              </div>

              <button className="link-btn subtle" onClick={rebuild} title="Rebuild lines from the words using the subtitle settings">
                Re-split lines…
              </button>
            </div>
          </aside>
        )}
      </div>

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          {job.undoCount > 0 && (
            <button className="link-btn" onClick={undo}>Undo</button>
          )}
        </div>
      )}
    </div>
  );
}

function CueRow({ cue, label, color, lowConfidence, suggestions, allSuggestions, threshold, playing, onPlay, onSave, onReviewed, onDelete, onAccept, onDismiss }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cue.text);

  const save = () => {
    setEditing(false);
    if (draft !== cue.text) onSave(draft);
  };

  const flagged = lowConfidence || suggestions.length > 0;

  return (
    <li className={`cue ${flagged ? 'flagged' : ''} ${playing ? 'playing' : ''}`}>
      <button className="tc" onClick={onPlay} title={playing ? 'Stop' : 'Play this line'}>
        <Icon name={playing ? 'pause' : 'play'} size={12} />
        {timecode(cue.start)}
      </button>
      <div className="cue-body">
        {label && (
          <div className="cue-track">
            <span className="dot" style={{ background: color }} /> {label}
          </div>
        )}
        {editing ? (
          <textarea
            className="cue-edit"
            autoFocus
            rows={Math.max(2, draft.split('\n').length)}
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
            className="cue-text"
            title="Click to edit"
            onClick={() => {
              setDraft(cue.text);
              setEditing(true);
            }}
          >
            <CueText cue={cue} threshold={threshold} highlights={suggestions.map((s) => s.from)} />
            {cue.edited && <span className="edited">edited</span>}
          </div>
        )}
        {suggestions.map((s) => (
          <Suggestion key={s.id} s={s} allSuggestions={allSuggestions} onAccept={onAccept} onDismiss={onDismiss} />
        ))}
      </div>
      <div className="cue-actions">
        {lowConfidence && !suggestions.length && (
          <button className="icon-btn" title="Looks right, clear the flag" onClick={onReviewed}>
            <Icon name="check" />
          </button>
        )}
        <button className="icon-btn" title="Delete line" onClick={onDelete}>
          <Icon name="trash" />
        </button>
      </div>
    </li>
  );
}

// One suggested fix. The replacement is editable before you apply it.
function Suggestion({ s, allSuggestions, onAccept, onDismiss }) {
  const [to, setTo] = useState(s.to);
  const same = allSuggestions.filter((x) => x.status === 'open' && x.from.toLowerCase() === s.from.toLowerCase()).length;
  const edited = to.trim() !== s.to;
  const source = s.source === 'ai' ? 'AI' : s.source === 'glossary' ? 'Glossary' : s.sourceLabel;
  const conf = s.verified;

  return (
    <div className="sug">
      <span className="sug-from">{s.from}</span>
      <span className="sug-arrow">→</span>
      <input
        className={`sug-to ${edited ? 'changed' : ''}`}
        value={to}
        size={Math.max(4, to.length + 1)}
        onChange={(e) => setTo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && to.trim()) onAccept(s, false, to.trim());
          if (e.key === 'Escape') setTo(s.to);
        }}
        title="Edit the replacement, then Fix"
      />
      <span className="sug-meta">
        {source}
        {s.source === 'ai' && s.reason && ` · ${s.reason}`}
        {conf != null && (
          <span className={`conf ${conf >= 0.8 ? 'hi' : conf < 0.4 ? 'lo' : ''}`} title="Jev's confidence that the fix is right">
            {' '}
            · {Math.round(conf * 100)}%
          </span>
        )}
      </span>
      <span className="grow" />
      <div className="sug-actions">
        <button className="primary small" disabled={!to.trim()} onClick={() => onAccept(s, false, to.trim())}>Fix</button>
        {same > 1 && (
          <button className="small" disabled={!to.trim()} onClick={() => onAccept(s, true, to.trim())}>
            Fix all {same}
          </button>
        )}
        <button className="ghost small" onClick={() => onDismiss(s)}>Ignore</button>
      </div>
    </div>
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
