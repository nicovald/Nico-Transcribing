# Development

[← Back to the README](../README.md)

## Development

Requires Node.js 22.19+ (or a supported newer Node release). On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`. Windows installs download the pinned FFmpeg/ffprobe pair in [media-tools.lock.json](../media-tools.lock.json) and verify its SHA-256 before extraction. Linux/macOS source runs require system `ffmpeg` and `ffprobe` on PATH, or the path overrides below.


```bash
npm ci
npm run app      # build UI + launch the desktop app (uses ./data)
npm run dev      # browser mode: API on :3462 (node --watch) + Vite on :5173
npm test         # backend, real media extraction and release safeguards
node scripts/desktop-smoke.mjs  # after build: isolated Electron interaction checks + screenshots
npm run dist     # Windows installer → release/Nicos-Transcriber-Setup-<version>.exe (no upload)
npm run release  # verified build + packaged checks + GitHub release (needs gh auth)
npm run media:install  # restore the pinned Windows media tools
npm run legal    # regenerate notices for installed dependencies and fonts
npm run icon     # rebuild electron/icon.ico from electron/icon.png (after changing the icon)
```

`Start Transcriber.bat` does `npm install` + `npm run app` for running from source.

Env vars: `DATA_DIR`, `PORT` (3462, browser mode), `HOST` (127.0.0.1), `OPEN_BROWSER=1`, `FFMPEG_PATH`, `FFPROBE_PATH`. Electron smoke test: `SCREENSHOT=out.png SCREENSHOT_HASH='#/settings' npx electron .` renders offscreen, captures the window and exits. Optional `SCREENSHOT_JS` (runs in the page first and writes its result to `<screenshot>.json`), `SCREENSHOT_WIDTH`, `SCREENSHOT_DELAY`. Each screenshot folder has an isolated `.electron-profile`, so tests can run beside an open app and never install updates. In Git Bash prefix with `MSYS_NO_PATHCONV=1`.

`node scripts/desktop-smoke.mjs` generates disposable synthetic audio and fake keys under `data/desktop-smoke/`, exercises saving, failed edits, undo, batch fixes, pagination and exports, verifies Windows key protection, and captures Settings, Project, Review and Export. It needs normal Windows account permissions for DPAPI. It makes no paid provider calls. Pass `"release/win-unpacked/Nicos Transcriber.exe"` as its first argument to check the packaged app. `npm test` includes HTTP failure cases, cancellation, timing, chunk reuse, atomic recovery and session isolation. GitHub Actions runs tests and the UI build on Windows and Linux, plus the desktop smoke check on Windows.

## Browser / Docker mode (optional)

The same server runs without Electron (`npm start` → <http://localhost:3462>), where videos are uploaded instead of read in place. `docker compose up -d --build` runs it on a server at port 3462. There is no login, so only expose it on a private network (a home LAN or a VPN such as Tailscale), never the open internet.

## Releasing

See [the release guide](RELEASING.md). Update the version and changelog, commit and push to `main`, then run on Windows:

```bash
npm run release:check  # read-only checks against GitHub; no build or upload
npm run release        # clean install, tests, build, packaged smoke, verified uploads
```

## Adding a transcriber

Create `server/providers/<name>.js` exporting `{ id, name, model, keyUrl, notes, transcribe({ file, key, model, options, signal }) }` resolving to `{ language, words: [{ text, start, end, confidence, speaker }] }` (seconds), register it in `server/providers/index.js`, and add a key slot to `DEFAULT_SETTINGS.keys` in `server/store.js`. Set `chunkSeconds` / `codec: 'mp3'` for APIs with small upload limits.

## How it works

1. **Import**: `ffprobe` lists audio streams; each is extracted with `ffmpeg` to 16 kHz mono FLAC in `data/media/<id>/`. The desktop app reads videos in place (no copy).
2. **Transcribe**: tracks (from any video in the project) are optionally cleaned with an ffmpeg filter chain and sent to the provider, up to 4 at a time across the whole app. Completed chunks are checkpointed for retry. Audio extracted from new imports preserves each stream's offset relative to the video timeline.
3. **Cues**: words → subtitle lines (split on sentence ends, pauses, speaker changes, max chars/duration; configurable).
4. **Suggestions**: `server/memory.js` (learned fixes + people, `data/memory.json`), `server/glossary.js` (sound-alike check), `server/suggestions.js`. The learned-fixes check and the glossary check run automatically first (free), then the AI proofread if enabled. The proofread chunks the transcript (150 lines per call) with a JSON schema and sends each chunk the priority terms plus up to 400 glossary names relevant to it, so 10,000+ name modpack lists stay affordable. Compare aligns the two providers' words per cue with an LCS diff. Suggestions only survive if their `from` text actually appears in the line. Edits are recorded in an undo history (`server/history.js`).
5. **Export**: SRT with UTF-8 BOM (Premiere/Resolve read accents correctly), unique track filenames, and an explicit choice for existing files. Text, suggestion state and undo history save atomically together in `jobs/<id>/transcript.json`; the last valid JSON version is kept as `.bak` and can recover a damaged file. Original legacy transcript files are retained on migration.

The stream-offset fix applies to newly imported audio. Reimport older source videos if their audio streams start late or early; existing transcripts are not silently retimed.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/version` | `{ name, version }` |
| GET | `/api/licenses` | Download bundled open-source notices |
| GET | `/api/activity` | Active job, import and check counts |
| GET/PUT | `/api/settings` | Keys masked; masked values sent back are ignored |
| GET | `/api/providers` | `{ transcribers, proofreaders }` |
| GET/POST | `/api/projects` | POST `{ name, presetId? }` (preset fills the description) |
| GET/PATCH/DELETE | `/api/projects/:id` | PATCH `{ name, context, presetId, setup }`; setup contains provider, options and track choices |
| POST | `/api/projects/:id/media` | `{ paths: [...] }`: import files from disk |
| POST | `/api/projects/:id/upload` | multipart `file` (browser mode) |
| PATCH/DELETE | `/api/media/:id` | PATCH `{ displayName }` |
| GET | `/api/media/:id/tracks/:n/audio` | Extracted FLAC (Range supported) |
| POST | `/api/jobs` | `{ projectId, provider, tracks: [{ mediaId, index, label }], options }` |
| GET/DELETE | `/api/jobs/:id` | Job + cues + suggestions |
| POST | `/api/jobs/:id/retry` · `/cancel` · `/rebuild` · `/proofread` | |
| POST | `/api/jobs/:id/glossary` | `{ termListIds? }`: re-run the sound-alike check, optionally with different lists |
| POST | `/api/jobs/:id/memory` | Re-run the learned fixes + people check |
| GET | `/api/memory` | `{ people, fixes }`; each fix has `tier`: `usual`, `unsure` or null |
| PUT | `/api/memory/people` | `{ people: [{ id?, name, aka, heardAs }] }` |
| POST/PATCH/DELETE | `/api/memory/fixes[/:id]` | POST `{ from, to }`; PATCH `{ pin }` (`usual`, `unsure`, `never` or null for automatic) |
| GET | `/api/memory/export` | Download the memory file |
| POST | `/api/memory/import` | Merge a memory file: `{ people, fixes }` counts of new entries |
| POST | `/api/team-setup` | `{ text }` of a .env file → saves recognized keys, returns `{ services, ignored }` (never the values); of an exported settings file → imports it, returns `{ imported }` |
| GET | `/api/team-setup/settings-export` | Download a settings file (no API keys) |
| GET | `/api/proofreaders/:id/models` | Models the saved key can use (`{ models, error? }`), for the Settings dropdown |
| GET | `/api/presets/minecraft` | Every vanilla name for the latest Java version |
| POST | `/api/terms/parse` | `{ text }` → `{ terms }` (lines, CSV, JSON) |
| POST | `/api/jobs/:id/compare` | `{ provider }` |
| POST | `/api/jobs/:id/suggestions/:sid/accept` | `{ all?, to? }` |
| POST | `/api/jobs/:id/suggestions/:sid/dismiss` | |
| POST | `/api/jobs/:id/undo` | Reverts the last edit (history in `jobs/<id>/transcript.json`, 100 steps) |
| PATCH/DELETE | `/api/jobs/:id/cues/:cueId` | `{ text, start, end, reviewed }` |
| GET | `/api/jobs/:id/srt-files` · `/api/jobs/:id/srt?file=<key>` | List / download |
| POST | `/api/jobs/:id/export/preview` | `{ dir?, keys? }`: filenames, destinations and existing-file flags |
| POST | `/api/jobs/:id/export` | `{ dir?, labels?, keys?, conflict? }`: conflict is `keep-both` or `replace`; an existing file without a choice returns 409 |
| GET | `/api/update` | Updater status (desktop only) |
| POST | `/api/update/check` · `/api/update/install` | Check now / restart into a downloaded update |

## Stack

Electron 44 + electron-updater · Node (Express 5, ESM) · React 19 + Vite · pinned FFmpeg/ffprobe (Windows), system FFmpeg (Docker) · JSON file storage · Anthropic SDK · Plus Jakarta Sans and Baloo 2 (bundled).

Design: "bright, playful productivity UI", light theme with ice-blue canvas, white cards and one blue primary action per screen. Rules in `CLAUDE.md`, tokens in `web/src/styles.css`.
