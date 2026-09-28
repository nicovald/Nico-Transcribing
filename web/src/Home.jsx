import { useRef, useState } from 'react';
import { api, formatTime } from './api.js';
import { navigate, useApp } from './App.jsx';
import { desktop, DropTarget, EditableText, Icon, isMediaFile, StatusPill } from './shared.jsx';
import usePoll from './usePoll.js';

// A stable, playful color per project for its tile.
const TILE_COLORS = ['#126ce0', '#7b61ff', '#ff7a45', '#1fbf7a', '#ff5fa2', '#2bb3ff', '#e0a100'];
const tileColor = (name) => TILE_COLORS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TILE_COLORS.length];

const busy = (p) => p.media.some((m) => m.status === 'importing' || m.status === 'queued') || p.jobs.some((j) => j.status === 'running');

export default function Home({ active }) {
  const { addFiles, addPaths, dataVersion, settings } = useApp();
  const [projects, setProjects, refresh, loadError] = usePoll(() => api.get('/api/projects'), (list) => active && list.some(busy), 2000, [dataVersion, active]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const [error, setError] = useState(null);
  const [pathInput, setPathInput] = useState('');
  const [presetId, setPresetId] = useState(() => (settings.presets.some((p) => p.id === settings.lastPresetId) ? settings.lastPresetId : ''));
  const preset = presetId || null;
  const fileInput = useRef();

  const run = async (fn) => {
    setError(null);
    try {
      const projectId = await fn();
      if (projectId) navigate(`/projects/${projectId}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const browse = () => {
    if (desktop) run(async () => {
      const paths = await desktop.pickVideos();
      return paths.length ? addPaths(paths, null, preset) : null;
    });
    else fileInput.current.click();
  };

  const rename = async (p, name) => {
    await api.patch(`/api/projects/${p.id}`, { name });
    refresh();
  };

  const remove = async (e, p) => {
    e.stopPropagation();
    if (!window.confirm(`Delete project "${p.name}" and its transcripts? Your video files are not touched.`)) return;
    await api.del(`/api/projects/${p.id}`);
    setProjects((list) => list.filter((x) => x.id !== p.id));
  };

  return (
    <div className="stack">
      <div className="page-head"><h1>Projects</h1><p className="muted">From source footage to reviewed subtitles, all in one place.</p></div>
      {settings.presets.length > 0 && (
        <div className="preset-bar">
          <span className="muted">New projects use</span>
          <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            <option value="">No preset</option>
            {settings.presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <DropTarget className="dropzone" onFiles={(files) => run(() => addFiles(files, null, preset))}>
        <div onClick={browse} className="dropzone-inner">
          <Icon name="film" size={24} />
          <div className="grow">
            <strong>Drop videos here to start a project</strong>
            <span className="muted">Drop several at once for multicam. Every audio track is pulled out automatically.</span>
          </div>
          <button className="primary" onClick={(e) => { e.stopPropagation(); browse(); }}>Choose videos…</button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="video/*,audio/*,.mkv,.mov,.mp4,.wav,.mp3,.flac,.mxf"
          hidden
          onChange={(e) => {
            const files = [...e.target.files].filter(isMediaFile);
            e.target.value = '';
            if (files.length) run(() => addFiles(files, null, preset));
          }}
        />
      </DropTarget>

      {!desktop && (
        <form
          className="path-row"
          onSubmit={(e) => {
            e.preventDefault();
            const paths = pathInput.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
            run(async () => {
              const id = await addPaths(paths, null, preset);
              setPathInput('');
              return id;
            });
          }}
        >
          <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder='Huge file? Paste its path (right-click → "Copy as path") to skip copying' />
          <button disabled={!pathInput.trim()}>Import</button>
        </form>
      )}

      {error && <div className="error">{error}</div>}
      {loadError && <div className="error">{loadError} <button onClick={refresh}>Try again</button></div>}

      <section>
        <div className="row library-toolbar"><h2 className="grow">Your library <span className="muted small">{projects?.length || 0} {projects?.length === 1 ? 'project' : 'projects'}</span></h2><input aria-label="Search projects" placeholder="Search projects…" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="Sort projects" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest first</option><option value="name">Name A–Z</option></select></div>
        {!projects ? (
          <p className="muted">Loading…</p>
        ) : !projects.length ? (
          <p className="muted">No projects yet. Drop a video above to get started.</p>
        ) : (
          <ul className="list">
            {projects.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt)).map((p) => {
              const tracks = p.media.reduce((n, m) => n + m.tracks.length, 0);
              const duration = Math.max(0, ...p.media.map((m) => m.duration || 0));
              const latest = p.jobs[0];
              return (
                <li key={p.id} onClick={() => navigate(`/projects/${p.id}`)}>
                  <span className="proj-tile" style={{ background: tileColor(p.name) }}><Icon name="film" size={18} /></span>
                  <div className="grow">
                    <div className="title">
                      <a href={`#/projects/${p.id}`}>{p.name}</a>
                    </div>
                    <div className="muted small">
                      {p.media.length} video{p.media.length === 1 ? '' : 's'} · {tracks} audio track{tracks === 1 ? '' : 's'}
                      {duration > 0 && ` · ${formatTime(duration)}`}
                      {p.jobs.length > 0 && ` · ${p.jobs.length} transcript${p.jobs.length === 1 ? '' : 's'}`}
                      {' · '}
                      {new Date(p.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {p.media.some((m) => m.status === 'importing' || m.status === 'queued') ? (
                    <StatusPill status="importing" />
                  ) : latest ? (
                    <StatusPill status={latest.status} />
                  ) : null}
                  <button className="icon-btn" title="Delete project" onClick={(e) => run(() => remove(e, p))}>
                    <Icon name="trash" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
