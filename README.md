# Grok Transcriber

Windows desktop app that turns the audio tracks of videos into timestamped **.srt subtitles** with AI speech-to-text, then helps you catch the words it got wrong. Built for editors working with multi-track, multicam gaming recordings.

- **Presets** per series or recording setup ("Minecraft vanilla", "ATM10 To The Sky"): description, term lists, player names, language, provider and track layout ("Track 1 = Sundee mic, Track 3 = game audio, skip"). Pick one before dropping videos and the project comes pre-filled; create them from any project with **Save as new preset**.
- **Projects**: drop one or more videos (multicam) and rename the project and each video for your own tracking. Your actual files are never renamed or moved.
- Every audio track is pulled out automatically. Name them ("Sundee mic", "Game audio") and tick the ones to transcribe.
- Transcribe with **Grok (xAI)**, **Deepgram**, **AssemblyAI**, **ElevenLabs Scribe** or **OpenAI Whisper**. The language and options you pick are remembered.
- **Find mistakes** like "Couples Stone" → "Cobblestone":
  - **Term lists** per game or modpack. Each has *priority terms* (up to ~100, sent to the transcriber) and *all terms* (unlimited, e.g. every Minecraft item). One click adds every vanilla Minecraft name (~1,850, from PrismarineJS/minecraft-data); drop .txt/.csv/.json files for modpacks.
  - **Glossary check** (free, instant) flags phrases that sound like a term but are spelled differently, using a phonetic key plus spelling/vowel checks to avoid flagging ordinary words.
  - **AI proofread** (Claude, OpenAI or Grok) reads the transcript with your project description and suggests fixes. You click **Fix** or **Fix all**.
  - **Compare** transcribes again with a second service and flags every word the two disagree on.
  - Optional **Jev (TypeSafe)** check scores each suggested fix with a confidence %.
- **Review**: edit any line, edit a suggested fix before applying it, and **Undo** (button, toast or Ctrl+Z) any fix, ignore, edit or delete. Use J/K for the next/previous issue, Space on a focused timecode to play, and the speed selector to slow down or speed up playback. Long transcripts show 100 lines per page.
- **Safe export**: preview one SRT per track plus a merged SRT per video, choose the files to save, and keep both versions or explicitly replace existing files.
- **Desktop protection**: API keys are encrypted with Windows account protection. The app warns before closing or restarting with active work or unsaved settings/line edits.
- **Updates itself** from GitHub Releases, so editors install once.

Current version and release history: see [CHANGELOG.md](CHANGELOG.md).

## For editors

1. Download **`Grok-Transcriber-Setup-x.y.z.exe`** from the latest [release](https://github.com/nicovald/Video-Transcribing/releases) (or get it from Nico) and run it. It installs and adds a desktop shortcut.
2. Open **Settings → Transcription**: expand one service, paste the API key you were given, and click **Save settings** (Ctrl+S). Other services are optional. A saved key is first validated by the service when you transcribe. Add a GitHub token under **App updates** (see below) for updates.
3. Pick a **preset** above the drop zone (or none), then drag videos onto the window. Check the track names, language and term lists, hit **Transcribe**.
4. When it's done, click **Needs a look**, fix or edit what's wrong, then **Save next to the videos**. Review the export preview and click **Export files**. Misclicked in the transcript? **Undo** or Ctrl+Z. AI checks run in the background and may take longer on large transcripts.

You can switch pages while things are running; nothing stops.

Track selections, labels, language and transcription options save automatically with each project. Editing or deleting a preset does not change projects that already use it. When some tracks fail, the transcript shows **Partly complete**; completed tracks remain editable and exportable. **Retry failed tracks** reuses completed audio chunks when the transcription settings are unchanged.

**Learned fixes** (sidebar) is the app's memory. Every **Fix**, **Ignore** and retyped misheard word counts. A fix you keep making becomes **Usually this** (gold, top of the To review panel, one click fixes every line); newer or mixed ones stay **Not sure** (purple). Nothing changes on its own. The **People** list holds the names usually in videos (with real names and known mishearings); names go to the transcriber and the proofreader, and sound-alikes are flagged. To share with the team, click **Export for the team** and send the file; teammates click **Import file** (merging never double counts).

**Team setup** (for studios): instead of typing keys, an editor can press **Ctrl+Shift+T** and drop a `.env` file you give them. Recognized names: `XAI_API_KEY`/`GROK_API_KEY`, `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ASSEMBLYAI_API_KEY`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, `GITHUB_TOKEN`. Keys are saved like typed ones and never shown again; other lines are skipped. Send the file privately and have them delete it afterwards.

Use **Save line** or Enter to save an edited subtitle; Escape cancels, Shift+Enter inserts a line break. A failed save keeps your typed text visible so you can try again. **Fix all** affects only flagged lines recommending that same replacement.

## Updates

The installed app updates itself from GitHub Releases of the private repo `nicovald/Video-Transcribing`. Each editor pastes a fine-grained GitHub token (Repository: Video-Transcribing, Contents: Read-only) in **Settings → Updates**. It checks on start and every 4 hours, downloads in the background, then shows **Restart to update**.

To publish a release: bump `version` in package.json, commit and push, then:

```bash
npm run release   # builds the installer, then uploads it + latest.yml to a GitHub release with the gh CLI
```

## Providers

| Transcriber | Default model | Per-word confidence | Notes |
|---|---|---|---|
| Grok (xAI) | `grok-voice-transcribe-2.0` | No | $0.10/hr. Language must be set for number/date formatting. |
| Deepgram | `nova-3` | Yes | |
| AssemblyAI | account default | Yes | Upload + poll |
| ElevenLabs | `scribe_v2` | Yes (logprob) | |
| OpenAI | `whisper-1` | Per sentence | 25 MB limit → 10-min chunks. `whisper-1` is deprecated (shutdown 2027-02-26). |

| Proofreader | Default model | Key |
|---|---|---|
| Claude | `claude-opus-5` | Anthropic key. Uses structured outputs + server-side refusal fallback. |
| OpenAI | `gpt-5.6` | Same OpenAI key as above. Change the model in Settings if needed. |
| Grok | `grok-4.7` | Same xAI key as above. |

Models are editable in Settings. In the desktop app, API keys and the GitHub update token are encrypted in `%APPDATA%\Grok Transcriber\data\settings.json` using Windows account protection; old plaintext keys migrate at startup. The settings backup is also protected. The UI receives only masked values. Audio goes to the selected transcription service, and transcript text goes to enabled proofreaders/verifiers. Browser/Docker mode stores keys in plaintext on its host.

Back up the installed app's `data` folder while the app is closed. Projects, extracted audio and transcripts are local. Protected keys require the Windows account that saved them; do not use a copied settings file to distribute credentials to other employees. Moving projects to another Windows account requires entering keys there again.

### Adding a transcriber

Create `server/providers/<name>.js` exporting `{ id, name, model, keyUrl, notes, transcribe({ file, key, model, options, signal }) }` resolving to `{ language, words: [{ text, start, end, confidence, speaker }] }` (seconds), register it in `server/providers/index.js`, and add a key slot to `DEFAULT_SETTINGS.keys` in `server/store.js`. Set `chunkSeconds` / `codec: 'mp3'` for APIs with small upload limits.

## How it works

1. **Import**: `ffprobe` lists audio streams; each is extracted with `ffmpeg` to 16 kHz mono FLAC in `data/media/<id>/`. The desktop app reads videos in place (no copy).
2. **Transcribe**: tracks (from any video in the project) are optionally cleaned with an ffmpeg filter chain and sent to the provider, up to 4 at a time across the whole app. Completed chunks are checkpointed for retry. Audio extracted from new imports preserves each stream's offset relative to the video timeline.
3. **Cues**: words → subtitle lines (split on sentence ends, pauses, speaker changes, max chars/duration; configurable).
4. **Suggestions**: `server/memory.js` (learned fixes + people, `data/memory.json`), `server/glossary.js` (sound-alike check), `server/suggestions.js`. The learned-fixes check and the glossary check run automatically first (free), then the AI proofread if enabled. The proofread chunks the transcript (150 lines per call) with a JSON schema and sends each chunk the priority terms plus up to 400 glossary names relevant to it, so 10,000+ name modpack lists stay affordable. Compare aligns the two providers' words per cue with an LCS diff. Suggestions only survive if their `from` text actually appears in the line. Edits are recorded in an undo history (`server/history.js`).
5. **Export**: SRT with UTF-8 BOM (Premiere/Resolve read accents correctly), unique track filenames, and an explicit choice for existing files. Text, suggestion state and undo history save atomically together in `jobs/<id>/transcript.json`; the last valid JSON version is kept as `.bak` and can recover a damaged file. Original legacy transcript files are retained on migration.

The stream-offset fix applies to newly imported audio. Reimport older source videos if their audio streams start late or early; existing transcripts are not silently retimed.

## Development

Requires Node.js 22.19+ (or a supported newer Node release). On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`.

```bash
npm install
npm run app      # build UI + launch the desktop app (uses ./data)
npm run dev      # browser mode: API on :3462 (node --watch) + Vite on :5173
npm test         # cue builder + suggestion/compare tests
node scripts/desktop-smoke.mjs  # after build: isolated Electron interaction checks + screenshots
npm run dist     # Windows installer → release/Grok-Transcriber-Setup-<version>.exe (no upload)
npm run release  # same, then publishes it as a GitHub release (needs gh auth)
npm run icon     # rebuild electron/icon.ico from electron/icon.png (after changing the icon)
```

`Start Transcriber.bat` does `npm install` + `npm run app` for running from source.

Env vars: `DATA_DIR`, `PORT` (3462, browser mode), `HOST` (127.0.0.1), `OPEN_BROWSER=1`, `FFMPEG_PATH`, `FFPROBE_PATH`. Electron smoke test: `SCREENSHOT=out.png SCREENSHOT_HASH='#/settings' npx electron .` renders offscreen, captures the window and exits. Optional `SCREENSHOT_JS` (runs in the page first and writes its result to `<screenshot>.json`), `SCREENSHOT_WIDTH`, `SCREENSHOT_DELAY`. Each screenshot folder has an isolated `.electron-profile`, so tests can run beside an open app and never install updates. In Git Bash prefix with `MSYS_NO_PATHCONV=1`.

`node scripts/desktop-smoke.mjs` generates disposable synthetic audio and fake keys under `data/desktop-smoke/`, exercises saving, failed edits, undo, batch fixes, pagination and exports, verifies Windows key protection, and captures Settings, Project, Review and Export. It needs normal Windows account permissions for DPAPI. It makes no paid provider calls. Pass `"release/win-unpacked/Grok Transcriber.exe"` as its first argument to check the packaged app. `npm test` includes HTTP failure cases, cancellation, timing, chunk reuse, atomic recovery and session isolation.

### Browser / Docker mode (optional)

The same server runs without Electron (`npm start` → <http://localhost:3462>), where videos are uploaded instead of read in place. `docker compose up -d --build` runs it on a server at port 3462. There is no login, so only expose it on a private network (a home LAN or a VPN such as Tailscale), never the open internet.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/version` | `{ name, version }` |
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
| POST | `/api/team-setup` | `{ text }` of a .env file → saves recognized keys, returns `{ services, ignored }` (never the values) |
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

Electron 44 + electron-updater · Node (Express 5, ESM) · React 19 + Vite · ffmpeg (bundled via ffmpeg-static) · JSON file storage · Anthropic SDK · Plus Jakarta Sans (bundled).

Design: "bright, playful productivity UI", light theme with ice-blue canvas, white cards and one blue primary action per screen. Rules in `CLAUDE.md`, tokens in `web/src/styles.css`.
