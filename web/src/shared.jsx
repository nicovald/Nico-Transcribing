import { useEffect, useRef, useState } from 'react';

// Bridge exposed by the Electron preload script; absent when running in a normal browser.
export const desktop = window.desktop ?? null;

export const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['nl', 'Dutch'],
  ['pl', 'Polish'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['tr', 'Turkish'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['sv', 'Swedish'],
  ['da', 'Danish'],
  ['no', 'Norwegian'],
  ['fi', 'Finnish'],
  ['', 'Auto-detect (less accurate formatting)'],
];

export function Progress({ value }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.round((value || 0) * 100)}%` }} />
    </div>
  );
}

export function StatusPill({ status }) {
  const label = { queued: 'Queued', importing: 'Importing…', running: 'Working…', done: 'Done', ready: 'Ready', error: 'Failed', cancelled: 'Cancelled' }[status] || status;
  return <span className={`pill pill-${status}`}>{label}</span>;
}

// Click-to-rename text. Saves on Enter/blur, Escape cancels.
export function EditableText({ value, onSave, className = '', placeholder = 'Untitled' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef();

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={input}
        className={`editable-input ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <span
      className={`editable ${className}`}
      title="Click to rename"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {value || placeholder}
      <span className="pencil">✎</span>
    </span>
  );
}

const VIDEO_EXT = /\.(mp4|mov|mkv|m4v|avi|webm|mxf|wav|mp3|flac|m4a|aac|ogg)$/i;
export const isMediaFile = (f) => VIDEO_EXT.test(f.name);

// Wraps children in a drag-and-drop target for video files.
export function DropTarget({ onFiles, children, className = '' }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return (
    <div
      className={`${className} ${over ? 'drop-over' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        if (--depth.current <= 0) {
          depth.current = 0;
          setOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = [...(e.dataTransfer.files || [])].filter(isMediaFile);
        if (files.length) onFiles(files);
      }}
    >
      {children}
    </div>
  );
}
