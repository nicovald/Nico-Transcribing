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
  const label = { queued: 'Queued', importing: 'Importing…', running: 'Working…', done: 'Done', partial: 'Partly complete', ready: 'Ready', error: 'Failed', cancelled: 'Cancelled' }[status] || status;
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
      <Icon name="edit" size={13} className="pencil" />
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

// Small line icons (16px, currentColor) instead of emoji.
const ICONS = {
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
  pause: <path d="M5 3.5v9M11 3.5v9" strokeWidth="2.2" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />,
  undo: <path d="M5.5 3.5L2.5 6.5l3 3M2.5 6.5h7a3.5 3.5 0 010 7H7" />,
  download: <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />,
  plus: <path d="M8 3v10M3 8h10" />,
  external: <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" />,
  edit: <path d="M10.5 2.5l3 3L6 13H3v-3z" />,
  check: <path d="M3 8.5l3.2 3L13 4.5" />,
  film: <path d="M2.5 3.5h11v9h-11zM5.5 3.5v9M10.5 3.5v9M2.5 6.5h3M2.5 9.5h3M10.5 6.5h3M10.5 9.5h3" />,
  folder: <path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />,
  star: <path d="M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z" />,
  users: <path d="M6 7.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M10.5 2.7a2.5 2.5 0 010 4.6M12 9.8c1.5.5 2.5 1.8 2.5 3.7" />,
  gear: <path d="M8 10a2 2 0 100-4 2 2 0 000 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />,
  upload: <path d="M8 10.5v-8M4.5 6L8 2.5 11.5 6M3 13.5h10" />,
  chevron: <path d="M6 3.5L10.5 8 6 12.5" />,
  help: <path d="M8 14.5a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM6.2 6.2a1.9 1.9 0 113 1.5c-.8.5-1.2.9-1.2 1.8M8 11.5v.01" />,
};

export function Icon({ name, size = 16, className = '' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="1" width="18" height="18" rx="5" fill="var(--accent)" />
      <rect x="5" y="7" width="10" height="2" rx="1" fill="#fff" />
      <rect x="5" y="11" width="6.5" height="2" rx="1" fill="#fff" />
    </svg>
  );
}
