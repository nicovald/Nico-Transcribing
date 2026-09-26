# Grok Transcriber

Windows desktop app (Electron) for editors: import multi-track/multicam videos into projects, transcribe each audio track with a pluggable STT provider, catch misheard words (term lists, AI proofread, cross-provider compare, optional Jev verification), export SRTs next to the videos.

## Layout
- `electron/main.js`: starts the Express server in-process on a random port, opens the window. `preload.cjs` exposes `window.desktop` (file paths, dialogs).
- `server/index.js`: API + serves `dist/`. Also runs standalone (`npm start`, Docker) in browser mode.
- `server/store.js`: JSON storage (projects, media, jobs, settings) + v0.1 migration.
- `server/jobs.js`: import (probe + extract per track to 16 kHz FLAC) and transcription jobs. Cues/words are keyed by **position in job.tracks**, not audio index.
- `server/providers/*.js`: transcribers, normalized to `{ language, words: [{ text, start, end, confidence, speaker }] }` in seconds.
- `server/suggestions.js` + `server/proofreaders.js`: AI proofread, compare, Jev, accept/dismiss.
- `server/srt.js`: words → cues → SRT.
- `web/src/`: React UI, hash routing. Home and Settings stay mounted so switching pages never loses state.
- `data/`: runtime state incl. API keys. Gitignored. Never commit.

## Rules
- API keys never go to the browser in full (masked `••••last4`).
- Provider API facts change often. Check official docs before editing an adapter. Grok STT has no per-word confidence and needs `language` when `format=true`. OpenAI word timestamps require `whisper-1`.
- Claude calls go through `@anthropic-ai/sdk` (not raw fetch).
- Never modify or rename the user's video files. Display names are ours only.
- Editors are non-technical: errors must be readable in the UI.
- Design: "bright, playful productivity UI" (light theme, overrides the global dark default). Ice-blue `#F3F8FC` canvas, white rounded cards, one vivid blue `#126CE0` primary action per screen (secondary actions use `.soft`/plain buttons), green for status/done, amber for things to review, navy text, Plus Jakarta Sans (bundled), outline icons from `Icon` in `shared.jsx` (no emoji), tactile buttons. Tokens live in `web/src/styles.css` `:root`.
- Bump `version` in package.json for releases (footer + `/api/version` + installer name).

## Run / verify
- `npm test`, `npm run build`, `npm run app` (desktop), `npm run dist` (installer in `release/`).
- Before calling something done: tests pass, UI builds, and an Electron smoke screenshot (`SCREENSHOT=...`, see README) of the changed page looks right.
