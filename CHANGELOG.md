# Changelog

Installers for each version are on the [GitHub releases](https://github.com/nicovald/Video-Transcribing/releases) page. Installed apps update themselves.

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
