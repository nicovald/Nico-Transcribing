import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatTime } from './api.js';
import { useApp } from './App.jsx';
import { desktop, Icon, Progress, StatusPill } from './shared.jsx';
import usePoll from './usePoll.js';
import useUnsaved from './useUnsaved.js';
import ExportDialog from './ExportDialog.jsx';
import JobSteps, { showSteps, trackStepText } from './JobSteps.jsx';

const TRACK_COLORS = ['#126ce0', '#e0701a', '#1a9e5c', '#8b4fd8', '#c99a0a', '#0f9bb0', '#d6407a', '#5b6b7d'];
const trackColor = (i) => TRACK_COLORS[i % TRACK_COLORS.length];
const running = (x) => x?.status === 'running' || x?.status === 'queued';
const isActive = (j) => running(j) || running(j.proofread) || running(j.compare) || running(j.glossary) || running(j.memory);
const TIER_LABEL = { usual: 'Usually this', unsure: 'Not sure' };
const fixKey = (s) => [s.from, s.to].map((v) => v.trim().replace(/\s+/g, ' ').toLowerCase()).join('|');
// Jev strongly disagreeing (<15%) almost always means a junk suggestion; tuck those away.
const UNLIKELY = 0.15;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// "SSundee mic" -> "SS", "Crainer" -> "CR" for the little speaker avatars.
const initials = (label = '') => {
  const words = label.replace(/(mic|track|audio|cam)/gi, '').trim().split(/s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
};
const sourceName = (s) => (s.source === 'ai' ? 'AI proofread' : s.source === 'glossary' ? 'Glossary' : s.sourceLabel);

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
  const [exportPlan, setExportPlan] = useState(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('playback-speed')) || 1);
  const [pending, setPending] = useState(false);
  const [editingCue, setEditingCue] = useState(null);
  const actionLock = useRef(false);
  const audio = useRef();
  const stopAt = useRef(null);
  const toastTimer = useRef();

  const doneCount = job?.tracks.filter((t) => t.status === 'done').length ?? 0;
  useEffect(() => {
    if (doneCount) api.get(`/api/jobs/${jobId}/srt-files`).then(setFiles).catch(err => setActionError(err.message));
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
  // The "To review" panel: one entry per distinct fix, learned "usually this" fixes first.
  const reviewGroups = useMemo(() => {
    const groups = new Map();
    for (const list of openSuggestions.values()) {
      for (const s of list) {
        const key = fixKey(s);
        if (!groups.has(key)) groups.set(key, { key, first: s, cueIds: new Set(), tier: s.tier === 'usual' ? 'usual' : 'unsure' });
        groups.get(key).cueIds.add(s.cueId);
      }
    }
    return [...groups.values()].sort((a, b) => (a.tier === b.tier ? b.cueIds.size - a.cueIds.size : a.tier === 'usual' ? -1 : 1));
  }, [openSuggestions]);
  const lowConfidence = (c) =>!c.edited && !c.reviewed && c.words?.some((w) => w.confidence != null && w.confidence < threshold);
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
    if (actionLock.current) return false;
    actionLock.current = true; setPending(true);
    setActionError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setActionError(err.message);
      return false;
    } finally { actionLock.current = false; setPending(false); }
  };
  useUnsaved(pending);
  useEffect(() => setPage(0), [trackFilter, show, search]);
  useEffect(() => setPage(p => Math.min(p,Math.max(0,Math.ceil(cues.length/100)-1))), [cues.length]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const jumpTo = (cueId) => {
    if (editingCue) return;
    const index = cues.findIndex((c) => c.id === cueId);
    if (index < 0) {
      // Filtered out: show everything, then jump.
      setTrackFilter('all'); setShow('all'); setSearch('');
      requestAnimationFrame(() => document.getElementById(`cue-${cueId}`)?.scrollIntoView({ block: 'center' }));
      setSelected(cueId);
      return;
    }
    setPage(Math.floor(index / 100)); setSelected(cueId);
    requestAnimationFrame(() => { const row = document.getElementById(`cue-${cueId}`); row?.scrollIntoView({ block: 'center' }); row?.querySelector('.tc')?.focus({ preventScroll: true }); });
  };
  const jumpIssue = direction => {
    if (editingCue) return;
    const current = cues.findIndex(c => c.id === selected);
    const issues = cues.map((c,i) => hasIssue(c) ? i : -1).filter(i => i >= 0);
    const index = direction > 0 ? issues.find(i => i > current) ?? issues[0] : issues.findLast(i => i < current) ?? issues.at(-1);
    if (index == null) return;
    setPage(Math.floor(index / 100)); setSelected(cues[index].id);
    requestAnimationFrame(() => { const row = document.getElementById(`cue-${cues[index].id}`); row?.scrollIntoView({ block: 'center' }); row?.querySelector('.tc')?.focus({ preventScroll: true }); });
  };
  useEffect(() => {
    const onKey = e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey || e.altKey || exportPlan) return;
      if (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'k') { e.preventDefault(); jumpIssue(e.key.toLowerCase() === 'j' ? 1 : -1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cues, selected, exportPlan, editingCue]);

  const undo = useCallback(
    () =>
      act(async () => {
        if (editingCue) return;
        const r = await api.post(`/api/jobs/${jobId}/undo`);
        setJob((j) => ({ ...j, cues: r.cues, suggestions: r.suggestions, undoCount: r.undoCount, undoLabel: r.undoLabel }));
        say(`Undid: ${r.label}`);
      }),
    [jobId, editingCue],
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
    el.playbackRate = speed;
    el.play().catch(() => { setPlaying(null); setActionError('Audio could not play. Check that the extracted audio is still available.'); });
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
      setJob((j) => ({ ...j, cues: j.cues.map((c) => (c.id === cue.id ? r.cue : c)), suggestions: r.suggestions }));
      withUndo(r);
      say(message);
    });

  const deleteCue = (cue) =>
    act(async () => {
      const r = await api.del(`/api/jobs/${job.id}/cues/${encodeURIComponent(cue.id)}`);
      setJob((j) => ({ ...j, cues: j.cues.filter((c) => c.id !== cue.id), suggestions: r.suggestions }));
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
      const plan = await api.post(`/api/jobs/${job.id}/export/preview`, { dir });
      setExportPlan({ ...plan, dir });
    });

  const saveToFolder = async () => {
    const dir = await desktop.pickFolder();
    if (dir) exportTo(dir);
  };

  const srtUrl = (f) => `/api/jobs/${job.id}/srt?file=${encodeURIComponent(f.key)}${f.merged && !labels ? '&labels=0' : ''}`;
  const canSaveNext = files.some((f) => f.canSaveNextToVideo);
  const checking = ['done','partial'].includes(job.status) && (running(job.glossary) || running(job.proofread) || running(job.compare));

  return (
    <div className="review">
      <header className="page-head">
        <div className="crumbs">
          <a href="#/">Projects</a>
          <span>/</span>
          <a href={`#/projects/${job.projectId}`}>{job.project?.name ?? 'Project'}</a>
        </div>
        <div className="review-title">
          <h1>{job.project?.name}</h1>
          <StatusPill status={job.status} />
          <span className="meta grow">
            {provider?.name} · {job.model} · {new Date(job.createdAt).toLocaleDateString()}
            {words > 0 && ` · ${words.toLocaleString()} words`}
          </span>
        </div>
        {showSteps(job) && <JobSteps job={job} providerName={provider?.name} />}
        <div className="track-list">
          {job.tracks.map((t, pos) => (
            <div key={pos} className="track-line">
              <span className="avatar" style={{ background: trackColor(pos) }}>{initials(t.label)}</span>
              <span>{trackName(pos)}</span>
              {running(t) && running(job) && <span className="muted">{trackStepText(t, provider?.name)}</span>}
              {t.status === 'running' && t.step?.parts > 1 && <Progress value={t.progress} />}
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
      {loadError && <div className="error">Updates paused: {loadError} <button onClick={refresh}>Reconnect</button></div>}
      {job.error && <div className="banner">{job.error} Completed tracks remain available for review and export.</div>}

      {checking && (
        <div className="strip">
          <span className="spinner" /> Checking for mistakes. Suggestions appear when each check finishes. You can keep reviewing.
        </div>
      )}

      <div className="review-layout">
        <section className="transcript">
          {job.cues.length > 0 ? (
            <>
              <div className="toolbar">
                <div className="segmented">
                  <button disabled={Boolean(editingCue)} className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>
                    All <span className="count">{job.cues.length}</span>
                  </button>
                  <button disabled={Boolean(editingCue)} className={show === 'issues' ? 'on' : ''} onClick={() => setShow('issues')}>
                    Needs a look <span className="count">{issueCount}</span>
                  </button>
                </div>
                {job.tracks.length > 1 && (
                  <select disabled={Boolean(editingCue)} aria-label="Filter by track" value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}>
                    <option value="all">All tracks</option>
                    {job.tracks.map((t, pos) => (
                      <option key={pos} value={pos}>{trackName(pos)}</option>
                    ))}
                  </select>
                )}
                <input disabled={Boolean(editingCue)} aria-label="Search transcript" className="grow search" placeholder="Search transcript" value={search} onChange={(e) => setSearch(e.target.value)} />
                <button className="icon-btn undo-btn" aria-label="Undo" disabled={Boolean(editingCue) || pending || !job.undoCount} onClick={undo} title={job.undoLabel ? `Undo: ${job.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}>
                  <Icon name="undo" size={18} />
                </button>
              </div>

              <div className="list-bar">
                <button className="small" onClick={() => jumpIssue(-1)} disabled={!cues.some(hasIssue)} title="Previous issue (K)">Prev issue <kbd>K</kbd></button>
                <button className="small" onClick={() => jumpIssue(1)} disabled={!cues.some(hasIssue)} title="Next issue (J)">Next issue <kbd>J</kbd></button>
                <span className="grow" />
                <select className="speed" aria-label="Playback speed" value={speed} onChange={e => { const value = Number(e.target.value); setSpeed(value); localStorage.setItem('playback-speed',value); if (audio.current) audio.current.playbackRate = value; }}>{[.75,1,1.25,1.5,2].map(v => <option key={v} value={v}>{v}× speed</option>)}</select>
              </div>
              <div className="list-hint">
                Click a timecode (or press Space on it) to play the line, click text to edit it.
                {!anyConfidence && ` ${provider?.name} has no per-word confidence, so flags come from the checks on the right.`}
                {unlikelyCount > 0 && (
                  <>
                    {' '}
                    <button disabled={Boolean(editingCue)} className="link-btn" onClick={() => setShowUnlikely(!showUnlikely)}>
                      {showUnlikely ? 'Hide' : 'Show'} {plural(unlikelyCount, 'unlikely suggestion')}
                    </button>
                  </>
                )}
              </div>

              <audio ref={audio} onTimeUpdate={onTime} onPause={() => setPlaying(null)} />

              <ul className="cues">
                {cues.slice(page * 100, (page + 1) * 100).map((c) => (
                  <CueRow
                    key={c.id}
                    cue={c}
                    pending={pending || Boolean(editingCue && editingCue !== c.id)}
                    onEditing={setEditingCue}
                    selected={selected === c.id}
                    onSelect={() => setSelected(c.id)}
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
              {cues.length > 100 && <div className="row pagination"><button disabled={Boolean(editingCue) || page === 0} onClick={() => setPage(p => p - 1)}>Previous page</button><span className="grow muted">Lines {page * 100 + 1}–{Math.min((page+1)*100,cues.length)} of {cues.length}</span><button disabled={Boolean(editingCue) || (page+1)*100 >= cues.length} onClick={() => setPage(p => p + 1)}>Next page</button></div>}
              {!cues.length && <p className="empty">{show === 'issues' ? 'Nothing left to look at.' : 'No lines match.'}</p>}
            </>
          ) : (
            <p className="empty">{running(job) ? 'Transcribing… lines appear here when each track finishes.' : 'No lines.'}</p>
          )}
        </section>

        {doneCount > 0 && (
          <aside className="side">
            <div className="side-section to-review">
              <div className="row">
                <h3 className="grow">To review</h3>
                {reviewGroups.length > 0 && <span className="badge-count">{reviewGroups.length}</span>}
              </div>
              {!reviewGroups.length ? (
                <p className="muted small">{checking ? 'Checking for mistakes…' : 'Nothing flagged. Nice.'}</p>
              ) : (
                ['usual', 'unsure'].map((tier) => {
                  const list = reviewGroups.filter((g) => g.tier === tier);
                  if (!list.length) return null;
                  return (
                    <div key={tier} className={`tier-group ${tier}`}>
                      <div className="tier-head"><Icon name={tier === 'usual' ? 'star' : 'help'} size={14} /> {TIER_LABEL[tier]}</div>
                      {list.slice(0, 12).map((g) => (
                        <div key={g.key} className="tier-item">
                          <button className="link-btn tier-jump" title="Show the line" onClick={() => jumpTo([...g.cueIds][0])}>
                            <span className="tier-fix">{g.first.from} → {g.first.to}</span>
                            <span className="tier-meta">{plural(g.cueIds.size, 'line')} · {g.first.source === 'learned' || g.first.source === 'people' ? g.first.reason : sourceName(g.first)}</span>
                          </button>
                          <button className={tier === 'usual' ? 'small gold' : 'small'} disabled={pending || Boolean(editingCue)} onClick={() => accept(g.first, g.cueIds.size > 1)}>
                            {g.cueIds.size > 1 ? `Fix all ${g.cueIds.size}` : 'Fix'}
                          </button>
                        </div>
                      ))}
                      {list.length > 12 && <p className="muted small">+{list.length - 12} more in the transcript</p>}
                    </div>
                  );
                })
              )}
              <a className="small-link" href="#/learned">Every Fix and Ignore teaches the app →</a>
            </div>

            <div className="side-section">
              <h3>Checks</h3>

              <div className="check-item">
                <div className="check-head">
                  <span>Learned fixes & people</span>
                  <button className="ghost small" disabled={running(job.memory)} onClick={() => act(async () => { await api.post(`/api/jobs/${job.id}/memory`); refresh(); })}>
                    {job.memory ? 'Run again' : 'Run'}
                  </button>
                </div>
                <p>
                  {running(job.memory)
                    ? 'Checking…'
                    : job.memory?.status === 'done'
                      ? `${plural(job.memory.count, 'match', 'matches')} from what the app has learned.`
                      : job.memory?.status === 'error'
                        ? <span className="error-text">{job.memory.error}</span>
                        : 'Fixes you made before and names from your people list. Free.'}
                </p>
              </div>

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

              <button disabled={Boolean(editingCue) || pending || running(job)} className="link-btn subtle" onClick={rebuild} title="Rebuild lines from the words using the subtitle settings">
                Re-split lines…
              </button>
            </div>
            {files.length > 0 && (
              <div className="side-section">
                <h3>Export</h3>
                {desktop && (
                  <div className="stack-tight">
                    {canSaveNext && (
                      <button className="primary" disabled={pending} onClick={() => exportTo()} title="Preview files and choose how to handle existing subtitles.">
                        Save next to the videos
                      </button>
                    )}
                    <button disabled={pending} onClick={saveToFolder}>
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

          </aside>
        )}
      </div>

      {exportPlan && <ExportDialog jobId={job.id} plan={exportPlan} labels={labels} onClose={() => setExportPlan(null)} onSaved={written => setNotice({ text: `Saved ${plural(written.length,'file')}`, path: written[0] })} />}

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          {job.undoCount > 0 && (
            <button disabled={Boolean(editingCue) || pending} className="link-btn" onClick={undo}>Undo</button>
          )}
        </div>
      )}
    </div>
  );
}

function CueRow({ cue, label, color, lowConfidence, suggestions, allSuggestions, threshold, playing, pending, selected, onSelect, onEditing, onPlay, onSave, onReviewed, onDelete, onAccept, onDismiss }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cue.text);

  useUnsaved(editing && draft !== cue.text, true);
  useEffect(() => { if (editing) { onEditing(cue.id); return () => onEditing(null); } }, [editing, cue.id, onEditing]);
  const save = async () => {
    if (draft === cue.text || await onSave(draft)) setEditing(false);
  };

  const flagged = lowConfidence || suggestions.length > 0;

  return (
    <li id={`cue-${cue.id}`} onFocus={onSelect} className={`cue ${flagged ? 'flagged' : ''} ${playing ? 'playing' : ''} ${selected ? 'selected-cue' : ''}`}>
      <button className="tc" onClick={onPlay} title={playing ? 'Stop' : 'Play this line'}>
        <Icon name={playing ? 'pause' : 'play'} size={12} />
        {timecode(cue.start)}
      </button>
      <div className="cue-body">
        <div className="cue-line">
        {label && (
          <span className="speaker" style={{ background: color }} title={label}>{label}</span>
        )}
        {editing ? (
          <div><textarea
            className="cue-edit"
            autoFocus
            rows={Math.max(2, draft.split('\n').length)}
            value={draft}
            disabled={pending}
            aria-label={`Edit subtitle at ${timecode(cue.start)}`}
            onChange={(e) => setDraft(e.target.value)}
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
          /><div className="row"><button className="primary small" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save line'}</button><button className="small" disabled={pending} onClick={() => { setDraft(cue.text); setEditing(false); }}>Cancel</button><span className="hint">Enter saves · Shift+Enter adds a line</span></div></div>
        ) : (
          <button type="button" disabled={pending}
            className="cue-text"
            title="Click to edit"
            onClick={() => {
              setDraft(cue.text);
              setEditing(true);
            }}
          >
            <CueText cue={cue} threshold={threshold} highlights={suggestions.map((s) => s.from)} />
            {cue.edited && <span className="edited">edited</span>}
          </button>
        )}
        </div>
        {suggestions.map((s) => (
          <Suggestion key={s.id} s={s} pending={pending || editing} allSuggestions={allSuggestions} onAccept={onAccept} onDismiss={onDismiss} />
        ))}
      </div>
      <div className="cue-actions">
        {lowConfidence && !suggestions.length && (
          <button className="icon-btn" title="Looks right, clear the flag" disabled={pending || editing} onClick={onReviewed}>
            <Icon name="check" />
          </button>
        )}
        <button className="icon-btn" title="Delete line" disabled={pending || editing} onClick={onDelete}>
          <Icon name="trash" />
        </button>
      </div>
    </li>
  );
}

// One suggested fix. The replacement is editable before you apply it.
function Suggestion({ s, pending, allSuggestions, onAccept, onDismiss }) {
  const [to, setTo] = useState(s.to);
  const norm = text => text.trim().toLowerCase().replace(/\s+/g,' ');
  const same = new Set(allSuggestions.filter(x => x.status === 'open' && norm(x.from) === norm(s.from) && norm(x.to) === norm(s.to)).map(x => x.cueId)).size;
  const edited = to.trim() !== s.to;
  const source = sourceName(s);
  const tier = ['learned', 'people'].includes(s.source) ? (s.tier === 'usual' ? 'usual' : 'unsure') : null;
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
      {tier && <span className={`tier ${tier}`}>{TIER_LABEL[tier]}</span>}
      <span className="sug-meta">
        {tier ? s.reason : source}
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
        <button className="soft small" disabled={pending || !to.trim()} onClick={() => onAccept(s, false, to.trim())}>Fix</button>
        {same > 1 && (
          <button className="small" disabled={pending || !to.trim()} onClick={() => onAccept(s, true, to.trim())}>
            Fix all {same}
          </button>
        )}
        <button className="ghost small" disabled={pending} onClick={() => onDismiss(s)}>Ignore</button>
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
        part.split(/(\s+)/).map((tok, j) => (low.has(tok) ? <span key={`${i}-${j}`} className="low-conf">{tok}</span> : tok))
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
