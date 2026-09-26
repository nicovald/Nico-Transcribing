import { useRef, useState } from 'react';
import { api, formatTime } from './api.js';
import { navigate, useApp } from './App.jsx';
import { desktop, DropTarget, EditableText, isMediaFile, StatusPill } from './shared.jsx';
import usePoll from './usePoll.js';

const busy = (p) => p.media.some((m) => m.status === 'importing' || m.status === 'queued') || p.jobs.some((j) => j.status === 'running');

export default function Home({ active }) {
  const { addFiles, addPaths, dataVersion } = useApp();
  const [projects, setProjects, refresh] = usePoll(() => api.get('/api/projects'), (list) => active && list.some(busy), 2000, [dataVersion, active]);
  const [error, setError] = useState(null);
  const [pathInput, setPathInput] = useState('');
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
      return paths.length ? addPaths(paths) : null;
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
      <DropTarget className="dropzone" onFiles={(files) => run(() => addFiles(files))}>
        <div onClick={browse} className="dropzone-inner">
          <div className="big">🎬</div>
          <strong>Drop videos here to start a project</strong>
          <span className="muted">Drop several at once for multicam. Every audio track is pulled out automatically.</span>
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
            if (files.length) run(() => addFiles(files));
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
              const id = await addPaths(paths);
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

      <section>
        <h2>Projects</h2>
        {!projects ? (
          <p className="muted">Loading…</p>
        ) : !projects.length ? (
          <p className="muted">No projects yet. Drop a video above to get started.</p>
        ) : (
          <ul className="list">
            {projects.map((p) => {
              const tracks = p.media.reduce((n, m) => n + m.tracks.length, 0);
              const duration = Math.max(0, ...p.media.map((m) => m.duration || 0));
              const latest = p.jobs[0];
              return (
                <li key={p.id} onClick={() => navigate(`/projects/${p.id}`)}>
                  <div className="grow">
                    <div className="title">
                      <EditableText value={p.name} onSave={(name) => rename(p, name)} />
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
                  <button className="ghost small-btn" title="Delete project" onClick={(e) => remove(e, p)}>
                    ✕
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
