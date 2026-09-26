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
- **Save all next to the videos**: one SRT per track plus a merged SRT per video, written straight into the video's folder.

## For editors

1. Run **`Grok Transcriber Setup x.y.z.exe`** (from Nico). It installs and adds a desktop shortcut.
2. Open **Settings** and paste the API key(s) you were given.
3. Drag videos onto the window. Name the tracks, pick the language, tick your term lists, hit **Transcribe**.
4. When it's done, go through **Needs a look**, fix what's wrong, then **Save all next to the videos**.

You can switch pages while things are running; nothing stops.

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

Models are editable in Settings. Keys are stored only on the local machine (`%APPDATA%\Grok Transcriber\data\settings.json` in the installed app) and are never sent to the UI in full.

### Adding a transcriber

Create `server/providers/<name>.js` exporting `{ id, name, model, keyUrl, notes, transcribe({ file, key, model, options, signal }) }` resolving to `{ language, words: [{ text, start, end, confidence, speaker }] }` (seconds), register it in `server/providers/index.js`, and add a key slot to `DEFAULT_SETTINGS.keys` in `server/store.js`. Set `chunkSeconds` / `codec: 'mp3'` for APIs with small upload limits.

## How it works

1. **Import**: `ffprobe` lists audio streams; each is extracted with `ffmpeg` to 16 kHz mono FLAC in `data/media/<id>/`. The desktop app reads videos in place (no copy).
2. **Transcribe**: tracks (from any video in the project) are optionally cleaned with an ffmpeg filter chain and sent to the provider, up to 4 at a time.
3. **Cues**: words → subtitle lines (split on sentence ends, pauses, speaker changes, max chars/duration; configurable).
4. **Suggestions**: `server/glossary.js` (sound-alike check), `server/suggestions.js`. The AI proofread chunks the transcript (150 lines per call) with a JSON schema; compare aligns the two providers' words per cue with an LCS diff. Suggestions only survive if their `from` text actually appears in the line.
5. **Export**: SRT with UTF-8 BOM (Premiere/Resolve read accents correctly).

## Development

```bash
npm install
npm run app      # build UI + launch the desktop app (uses ./data)
npm run dev      # browser mode: API on :3462 (node --watch) + Vite on :5173
npm test         # cue builder + suggestion/compare tests
npm run dist     # Windows installer → release/Grok Transcriber Setup <version>.exe
```

`Start Transcriber.bat` does `npm install` + `npm run app` for running from source.

Env vars: `DATA_DIR`, `PORT` (3462, browser mode), `HOST` (127.0.0.1), `OPEN_BROWSER=1`, `FFMPEG_PATH`, `FFPROBE_PATH`. Electron smoke test: `SCREENSHOT=out.png SCREENSHOT_HASH='#/settings' npx electron .` captures the window and exits (in Git Bash prefix with `MSYS_NO_PATHCONV=1`).

### Browser / Docker mode (optional)

The same server runs without Electron (`npm start` → <http://localhost:3462>), where videos are uploaded instead of read in place. `docker compose up -d --build` runs it on a server at port 3462. There is no login, so only expose it on a private network (a home LAN or a VPN such as Tailscale), never the open internet.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/version` | `{ name, version }` |
| GET/PUT | `/api/settings` | Keys masked; masked values sent back are ignored |
| GET | `/api/providers` | `{ transcribers, proofreaders }` |
| GET/POST | `/api/projects` | POST `{ name }` |
| GET/PATCH/DELETE | `/api/projects/:id` | PATCH `{ name, context }` |
| POST | `/api/projects/:id/media` | `{ paths: [...] }`: import files from disk |
| POST | `/api/projects/:id/upload` | multipart `file` (browser mode) |
| PATCH/DELETE | `/api/media/:id` | PATCH `{ displayName }` |
| GET | `/api/media/:id/tracks/:n/audio` | Extracted FLAC (Range supported) |
| POST | `/api/jobs` | `{ projectId, provider, tracks: [{ mediaId, index, label }], options }` |
| GET/DELETE | `/api/jobs/:id` | Job + cues + suggestions |
| POST | `/api/jobs/:id/retry` · `/cancel` · `/rebuild` · `/proofread` · `/glossary` | |
| GET | `/api/presets/minecraft` | Every vanilla name for the latest Java version |
| POST | `/api/terms/parse` | `{ text }` → `{ terms }` (lines, CSV, JSON) |
| POST | `/api/jobs/:id/compare` | `{ provider }` |
| POST | `/api/jobs/:id/suggestions/:sid/accept` | `{ all?, to? }` |
| POST | `/api/jobs/:id/suggestions/:sid/dismiss` | |
| PATCH/DELETE | `/api/jobs/:id/cues/:cueId` | `{ text, start, end, reviewed }` |
| GET | `/api/jobs/:id/srt-files` · `/api/jobs/:id/srt?file=<key>` | List / download |
| POST | `/api/jobs/:id/export` | `{ dir?, labels?, keys? }`: write SRTs next to videos or into `dir` |

## Stack

Electron 44 · Node (Express 5, ESM) · React 19 + Vite · ffmpeg (bundled via ffmpeg-static) · JSON file storage · Anthropic SDK.
