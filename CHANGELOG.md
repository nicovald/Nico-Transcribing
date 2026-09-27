# Changelog

Installers for each version are on the [GitHub releases](https://github.com/nicovald/Video-Transcribing/releases) page. Installed apps update themselves.

## 0.10.0 (2026-09-26)
- Team setup: press **Ctrl+Shift+T** anywhere and drop a `.env` file to load a studio's API keys. Keys are saved like typed ones (protected by Windows, masked in the UI) and never sent back to the page.

## 0.9.0 (2026-09-26)
- **Learned fixes**: every Fix, Ignore and retyped word teaches the app. Fixes you keep making (3+ times, almost never ignored) are flagged as **Usually this** with a one-click Fix all; newer or mixed ones show as **Not sure**. Nothing is ever changed automatically. Manage, pin or forget fixes on the new Learned fixes page.
- **People list**: SSundee (Ian), Crainer (Benjamin), Lookum, Pat, Nico and Roman are preloaded. Names are sent to the transcriber and the AI proofread; sound-alikes ("Craner", "Craners", "Look um") and listed mishearings ("Sunday") are flagged as Not sure.
- **Share with the team**: Export / Import a memory file. Importing merges without double counting.
- New look: sidebar with recent projects, colorful game-style accents (gold = Usually this, purple = Not sure), friendlier headings. Review page: compact header, speaker on the same line as the text, a To review panel above Export. Slimmer drop zone on Projects.
- Confident learned fixes are also sent to the transcriber as key terms, so the same mistake gets rarer.

## 0.8.0 (2026-09-26)
- Desktop workspace improvements: searchable/sortable project library, sectioned settings, visible save states, persistent project track choices and preset snapshots.
- Faster review: J/K issue navigation, playback speed, explicit line save/cancel, retained text after failed saves, and pagination for long transcripts.
- Export preview with file selection, duplicate filename protection and Keep both / Replace choices. Partial track failures have a distinct status.
- Atomic transcript/suggestion/undo storage with last-good backups; stale check results cannot overwrite edited lines or resurrect accepted suggestions. Fix all affects exactly the matching flagged lines.
- Reliable cancellation/deletion for imports, jobs and checks; four concurrent tracks across the app; completed transcription chunks reused on retry.
- Preserve audio stream timing on new imports; validate IDs, track ownership, settings and cue timing; handle interrupted uploads without crashing.
- Windows-protected API keys, isolated desktop API session, remembered window size and guards against closing/restarting with active work or unsaved changes.
- Added backend regression tests and a real Electron interaction/screenshot smoke test. Node minimum aligned to 22.19.

## 0.7.1 (2026-09-26)
- New app icon (speech bubble with sound wave and subtitle lines), and it now actually shows on the .exe, shortcut and taskbar. Before, Windows showed a generic icon because the generated .ico used PNG for every size.

## 0.7.0 (2026-09-26)
- New look: "bright, playful productivity UI". Light ice-blue theme, white rounded cards, one blue primary action per screen, tactile buttons, bundled Plus Jakarta Sans, new app icon.

## 0.6.0
- Suggested fixes are editable before you apply them.
- Undo for fixes, ignores, line edits, "looks right" and deletes: toolbar button, toast link, Ctrl+Z (100 steps, saved per transcript).
- Review screen redesigned: transcript plus a sidebar for Export and Checks; emoji replaced with outline icons.

## 0.5.2
- "Checking for mistakes…" and "N possible mistakes → Review" banners, since the proofread lands after the transcript.
- Suggestions Jev rates under 15% are hidden behind a link.
- Glossary check can pick term lists after the fact; setup warns when no list is ticked.

## 0.5.1
- Presets are easier to find: explanation and "Save setup as preset" when there are none.

## 0.5.0
- Presets: description, term lists, player names, language, provider and track layout per series.
- Proofread only sends each chunk the relevant glossary terms (handles 10,000+ name modpack lists).

## 0.4.0
- Self-update from GitHub Releases (paste a GitHub token in Settings → Updates).

## 0.3.x
- Term lists with priority terms (sent to the transcriber) and full glossaries (unlimited).
- One-click list of every vanilla Minecraft name.
- Free sound-alike glossary check.

## 0.2.0
- Desktop app (Electron) with an installer; videos are read in place.
- Projects holding several videos (multicam), renamable projects and videos.
- AI proofread (Claude, OpenAI or Grok), second-opinion comparison, optional Jev verification.
- Remembered language dropdown.

## 0.1.0
- Local web app: import a video, extract every audio track, transcribe with Grok, Deepgram, AssemblyAI, ElevenLabs or OpenAI, review and export SRT.
