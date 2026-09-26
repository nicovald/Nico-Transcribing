import { useEffect, useRef, useState } from 'react';
import { api, formatTime } from './api.js';
import { navigate, useApp } from './App.jsx';
import { desktop, DropTarget, EditableText, isMediaFile, LANGUAGES, Progress, StatusPill } from './shared.jsx';
import usePoll from './usePoll.js';

// Unsent setup choices per project, kept while you visit other pages.
const drafts = new Map();
const NEW_PRESET = '__new__';

const listSize = (l) =>
  String(l.glossary || '').split('\n').filter((t) => t.trim()).length + String(l.terms || '').split(/[\n,]/).filter((t) => t.trim()).length;

const importing = (m) => m.status === 'importing' || m.status === 'queued';
const trackKey = (mediaId, index) => `${mediaId}:${index}`;

function importPercent(m) {
  if (!m.tracks.length) return 0;
  const done = m.tracks.reduce((sum, t) => sum + (t.extracted ? 1 : t.progress || 0), 0);
  return done / m.tracks.length;
}

export default function Project({ projectId }) {
  const { providers, settings, addFiles, addPaths, dataVersion } = useApp();
  const [project, setProject, refresh, loadError] = usePoll(
    () => api.get(`/api/projects/${projectId}`),
    (p) => p.media.some(importing) || p.jobs.some((j) => j.status === 'running'),
    1500,
    [projectId, dataVersion],
  );
  const [error, setError] = useState(null);
  const [presetRequest, setPresetRequest] = useState(0);
  const fileInput = useRef();
  // Opens the "name your preset" box in the Transcribe section and scrolls to it.
  const requestPreset = () => setPresetRequest((n) => n + 1);

  if (loadError && !project) return <div className="error">{loadError}</div>;
  if (!project) return <p className="muted">Loading…</p>;

  const act = async (fn) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const addVideos = () => {
    if (desktop) act(async () => {
      const paths = await desktop.pickVideos();
      if (paths.length) await addPaths(paths, project.id);
    });
    else fileInput.current.click();
  };

  const patchProject = (patch) => act(async () => setProject({ ...project, ...(await api.patch(`/api/projects/${project.id}`, patch)) }));
  const renameMedia = (m, displayName) => act(() => api.patch(`/api/media/${m.id}`, { displayName }));
  const removeMedia = (m) => {
    if (window.confirm(`Remove "${m.displayName}" from this project? The video file itself is not touched.`)) act(() => api.del(`/api/media/${m.id}`));
  };

  return (
    <DropTarget className="stack" onFiles={(files) => act(() => addFiles(files, project.id))}>
      <div className="crumbs">
        <a href="#/">Projects</a> ›
      </div>
      <section className="card">
        <h1>
          <EditableText value={project.name} onSave={(name) => patchProject({ name })} />
        </h1>
        {settings.presets.length ? (
          <label>
            Preset
            <select
              value={project.presetId || ''}
              onChange={(e) => (e.target.value === NEW_PRESET ? requestPreset() : patchProject({ presetId: e.target.value || null }))}
            >
              <option value="">No preset</option>
              {settings.presets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value={NEW_PRESET}>＋ Save this project's setup as a new preset…</option>
            </select>
            <span className="hint">A preset fills in the description, term lists, language and track names below. Edit presets in Settings.</span>
          </label>
        ) : (
          <div className="preset-empty">
            <div className="grow">
              <strong>No presets yet.</strong>{' '}
              <span className="muted">
                A preset remembers this whole setup (term lists, description, language, track names) so the next video in the series is one click. Set up the Transcribe section below, then save it.
              </span>
            </div>
            <button disabled={!project.media.some((m) => m.status === 'ready')} onClick={requestPreset}>Save setup as preset…</button>
          </div>
        )}
        <label>
          What's in this video?
          <ContextInput value={project.context} onSave={(context) => patchProject({ context })} />
          <span className="hint">Helps the AI proofread fix game terms and names, e.g. "Minecraft modded survival, players Sundee and Crainer".</span>
        </label>
      </section>

      {error && <div className="error">{error}</div>}

      <section className="stack-tight">
        <div className="row">
          <h2 className="grow">Videos</h2>
          <button onClick={addVideos}>＋ Add videos</button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept="video/*,audio/*,.mkv,.mov,.mp4,.wav,.mp3,.flac,.mxf"
            onChange={(e) => {
              const files = [...e.target.files].filter(isMediaFile);
              e.target.value = '';
              if (files.length) act(() => addFiles(files, project.id));
            }}
          />
        </div>
        {!project.media.length && <p className="muted">No videos yet. Drop some here.</p>}
        {project.media.map((m) => (
          <div key={m.id} className="card video-card">
            <div className="row">
              <div className="grow">
                <div className="title">
                  <EditableText value={m.displayName} onSave={(name) => renameMedia(m, name)} />
                </div>
                <div className="muted small" title={m.sourcePath}>
                  {m.name}
                  {m.duration ? ` · ${formatTime(m.duration)}` : ''}
                </div>
              </div>
              {m.status !== 'ready' && <StatusPill status={m.status} />}
              <button className="ghost small-btn" title="Remove from project" onClick={() => removeMedia(m)}>✕</button>
            </div>
            {importing(m) && <Progress value={importPercent(m)} />}
            {m.status === 'error' && <div className="error">{m.error}</div>}
          </div>
        ))}
      </section>

      {project.media.some((m) => m.status === 'ready') && (
        <Setup
          key={project.presetId || 'none'}
          project={project}
          providers={providers.transcribers}
          settings={settings}
          presetRequest={presetRequest}
          onPresetSaved={(presetId) => patchProject({ presetId })}
        />
      )}

      {project.jobs.length > 0 && (
        <section>
          <h2>Transcripts</h2>
          <ul className="list">
            {project.jobs.map((j) => (
              <li key={j.id} onClick={() => navigate(`/jobs/${j.id}`)}>
                <div className="grow">
                  <div className="title">
                    {providers.transcribers.find((p) => p.id === j.provider)?.name || j.provider} · {j.trackCount} track{j.trackCount === 1 ? '' : 's'}
                  </div>
                  <div className="muted small">
                    {j.model} · {new Date(j.createdAt).toLocaleString()}
                  </div>
                </div>
                <StatusPill status={j.status} />
                <button
                  className="ghost small-btn"
                  title="Delete transcript"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('Delete this transcript?')) act(() => api.del(`/api/jobs/${j.id}`));
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </DropTarget>
  );
}

// One shared player so only one track previews at a time.
const previewAudio = new Audio();
let previewSetter = null;

function TrackPreview({ src }) {
  const [state, setState] = useState({ playing: false, time: 0 });
  useEffect(() => () => {
    if (previewSetter === setState) {
      previewAudio.pause();
      previewSetter = null;
    }
  }, []);

  const toggle = () => {
    if (state.playing) {
      previewAudio.pause();
      setState((s) => ({ ...s, playing: false }));
      return;
    }
    previewSetter?.((s) => ({ ...s, playing: false }));
    previewSetter = setState;
    if (!previewAudio.src.endsWith(src)) {
      previewAudio.src = src;
      // Resume where this track was last paused.
      previewAudio.currentTime = state.time || 0;
    }
    previewAudio.ontimeupdate = () => setState({ playing: !previewAudio.paused, time: previewAudio.currentTime });
    previewAudio.play();
    setState((s) => ({ ...s, playing: true }));
  };

  const skip = (sec) => {
    if (previewSetter !== setState) return;
    previewAudio.currentTime = Math.max(0, previewAudio.currentTime + sec);
  };

  return (
    <div className="preview">
      <button className="small-btn" onClick={toggle}>{state.playing ? '❚❚ Pause' : '▶ Listen'}</button>
      {state.playing && <button className="ghost small-btn" title="Skip ahead 60s" onClick={() => skip(60)}>+60s</button>}
      <span className="muted small">{formatTime(state.time)}</span>
    </div>
  );
}

function ContextInput({ value, onSave }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => setDraft(value || ''), [value]);
  return (
    <input
      value={draft}
      placeholder="e.g. Minecraft let's play with 3 players"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (value || '') && onSave(draft)}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
    />
  );
}

function Setup({ project, providers, settings, presetRequest, onPresetSaved }) {
  const { reloadSettings } = useApp();
  const preset = settings.presets.find((p) => p.id === project.presetId) ?? null;
  const draftKey = `${project.id}:${project.presetId || ''}`;
  // Defaults come from the project's preset, otherwise from what you used last time.
  const base = preset ?? { ...settings.lastOptions };
  const [draft, setDraftState] = useState(
    () =>
      drafts.get(draftKey) ?? {
        tracks: {}, // key -> { on, label }
        provider: base.provider || settings.lastOptions.provider,
        options: {
          language: base.language ?? 'en',
          termListIds: (base.termListIds || []).filter((id) => settings.termLists.some((l) => l.id === id)),
          keyterms: base.keyterms || '',
          voiceCleanup: base.voiceCleanup ?? true,
          fillerWords: base.fillerWords ?? false,
          diarize: base.diarize ?? false,
        },
      },
  );
  const [saving, setSaving] = useState(null); // null | { name }
  const saveBox = useRef();
  useEffect(() => {
    if (!presetRequest) return;
    setSaving((s) => s ?? { name: '' });
    requestAnimationFrame(() => saveBox.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [presetRequest]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const setDraft = (fn) =>
    setDraftState((d) => {
      const next = fn(d);
      drafts.set(draftKey, next);
      return next;
    });

  const ready = project.media.filter((m) => m.status === 'ready');
  const trackState = (m, t) =>
    draft.tracks[trackKey(m.id, t.index)] ?? {
      on: preset?.tracks?.[t.index]?.on ?? true,
      label: preset?.tracks?.[t.index]?.name || t.title || `Track ${t.index + 1}`,
    };
  const setTrack = (m, t, patch) =>
    setDraft((d) => ({ ...d, tracks: { ...d.tracks, [trackKey(m.id, t.index)]: { ...trackState(m, t), ...patch } } }));
  const setOpt = (k, v) => setDraft((d) => ({ ...d, options: { ...d.options, [k]: v } }));
  const toggleList = (id) =>
    setOpt('termListIds', draft.options.termListIds.includes(id) ? draft.options.termListIds.filter((x) => x !== id) : [...draft.options.termListIds, id]);

  const chosen = ready.flatMap((m) => m.tracks.filter((t) => trackState(m, t).on).map((t) => ({ mediaId: m.id, index: t.index, label: trackState(m, t).label })));
  const hasKey = (id) => Boolean(settings.keys[id]);
  const termCount = settings.termLists.filter((l) => draft.options.termListIds.includes(l.id)).reduce((n, l) => n + l.terms.split(/[\n,]/).filter((t) => t.trim()).length, 0);

  // Snapshot of the current setup; the track layout comes from the first video.
  const presetFromDraft = (name, id) => ({
    id,
    name,
    context: project.context || '',
    provider: draft.provider,
    ...draft.options,
    tracks: (ready[0]?.tracks || []).map((t) => {
      const st = trackState(ready[0], t);
      return { name: st.label, on: st.on };
    }),
  });

  const savePreset = async (asNew) => {
    const name = asNew ? saving?.name?.trim() : preset.name;
    if (!name) return;
    const id = asNew ? crypto.randomUUID() : preset.id;
    const next = asNew ? [...settings.presets, presetFromDraft(name, id)] : settings.presets.map((p) => (p.id === id ? presetFromDraft(name, id) : p));
    await api.put('/api/settings', { presets: next });
    await reloadSettings();
    setSaving(null);
    drafts.delete(draftKey);
    if (asNew) onPresetSaved(id);
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const job = await api.post('/api/jobs', { projectId: project.id, provider: draft.provider, tracks: chosen, options: draft.options });
      drafts.delete(draftKey);
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Transcribe</h2>
      <p className="muted small">Tick the tracks to transcribe and name them (e.g. "Sundee mic", "Game audio"). Names are used in file names and merged subtitles.</p>

      {ready.map((m) => (
        <div key={m.id} className="tracks">
          {ready.length > 1 && <div className="tracks-title">{m.displayName}</div>}
          {m.tracks.map((t) => {
            const st = trackState(m, t);
            return (
              <div key={t.index} className={`track ${st.on ? '' : 'off'}`}>
                <input type="checkbox" checked={st.on} onChange={(e) => setTrack(m, t, { on: e.target.checked })} />
                <input className="label-input" value={st.label} onChange={(e) => setTrack(m, t, { label: e.target.value })} />
                <span className="muted small">
                  #{t.index + 1} · {t.channels === 1 ? 'mono' : t.channels === 2 ? 'stereo' : `${t.channels}ch`}
                  {t.language && ` · ${t.language}`}
                </span>
                <TrackPreview src={`/api/media/${m.id}/tracks/${t.index}/audio`} />
              </div>
            );
          })}
        </div>
      ))}

      <div className="grid-2">
        <label>
          Provider
          <select value={draft.provider} onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value }))}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {hasKey(p.id) ? '' : ' (no key)'}
              </option>
            ))}
          </select>
          <span className="hint">{providers.find((p) => p.id === draft.provider)?.notes}</span>
        </label>
        <label>
          Language
          <select value={draft.options.language} onChange={(e) => setOpt('language', e.target.value)}>
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          <span className="hint">Remembered for next time.</span>
        </label>
      </div>

      <div>
        <div className="label-like">
          Term lists <span className="hint-inline">click to tick the lists this video uses (✓ = on)</span>
        </div>
        <div className="chips">
          {settings.termLists.map((l) => (
            <button key={l.id} className={`chip-toggle ${draft.options.termListIds.includes(l.id) ? 'on' : ''}`} onClick={() => toggleList(l.id)}>
              {draft.options.termListIds.includes(l.id) ? '✓ ' : ''}
              {l.name}
              <span className="muted"> · {listSize(l).toLocaleString()}</span>
            </button>
          ))}
          <a href="#/settings" className="small">
            {settings.termLists.length ? 'Edit lists' : '＋ Make a term list (e.g. Minecraft)'}
          </a>
        </div>
        <textarea
          rows={2}
          value={draft.options.keyterms}
          onChange={(e) => setOpt('keyterms', e.target.value)}
          placeholder="Extra terms just for this video, comma separated (player names, mod names…)"
        />
        {settings.termLists.length > 0 && !draft.options.termListIds.length && (
          <span className="hint warn-text">No term lists ticked, so game words won't be checked against your lists. Click a list above to use it.</span>
        )}
        {termCount > 0 && (
          <span className="hint">
            {termCount} priority term{termCount === 1 ? '' : 's'} go to the transcriber{termCount > 100 ? ' (Grok uses the first 100)' : ''}; the full lists are used to check the transcript afterwards.
          </span>
        )}
      </div>

      <div className="checks">
        <label>
          <input type="checkbox" checked={draft.options.voiceCleanup} onChange={(e) => setOpt('voiceCleanup', e.target.checked)} /> Voice cleanup
          <span className="hint-inline">(filters game audio, evens out volume)</span>
        </label>
        <label>
          <input type="checkbox" checked={draft.options.diarize} onChange={(e) => setOpt('diarize', e.target.checked)} /> Split by speaker
          <span className="hint-inline">(several people on one track)</span>
        </label>
        <label>
          <input type="checkbox" checked={draft.options.fillerWords} onChange={(e) => setOpt('fillerWords', e.target.checked)} /> Keep "um"/"uh"
        </label>
      </div>

      {error && <div className="error">{error}</div>}
      {!hasKey(draft.provider) && (
        <div className="banner">
          No key for this provider yet. <a href="#/settings">Add it in Settings</a>.
        </div>
      )}
      <div className="row wrap">
        <button className="primary big-btn" disabled={busy || !chosen.length || !hasKey(draft.provider)} onClick={start}>
          {busy ? 'Starting…' : `Transcribe ${chosen.length} track${chosen.length === 1 ? '' : 's'}`}
        </button>
        <span className="grow" />
        {saving ? (
          <form
            ref={saveBox}
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              savePreset(true);
            }}
          >
            <input autoFocus value={saving.name} onChange={(e) => setSaving({ name: e.target.value })} placeholder="Preset name, e.g. ATM10 To The Sky" />
            <button className="primary" disabled={!saving.name.trim()}>Save</button>
            <button type="button" className="ghost" onClick={() => setSaving(null)}>Cancel</button>
          </form>
        ) : (
          <>
            {preset && (
              <button title="Overwrite the preset with the choices above" onClick={() => savePreset(false)}>
                Update "{preset.name}"
              </button>
            )}
            <button onClick={() => setSaving({ name: '' })}>Save as new preset</button>
          </>
        )}
      </div>
    </section>
  );
}
