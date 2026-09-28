<p align="center">
  <img src="docs/screenshots/banner.png" alt="Nico's Transcriber: turn every audio track of your videos into .srt subtitles, then catch the words the AI got wrong">
</p>

<p align="center">
  <a href="https://github.com/nicovald/Video-Transcribing/releases/latest"><img src="https://img.shields.io/badge/Download_for_Windows-126CE0?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows"></a>
</p>

<p align="center">
  <a href="https://github.com/nicovald/Video-Transcribing/releases/latest"><img src="https://img.shields.io/github/v/release/nicovald/Video-Transcribing?label=version&color=1A9E5C" alt="Latest version"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-126CE0" alt="Windows 10/11">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-7B61FF" alt="MIT license"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/changelog-what's_new-FFB020" alt="Changelog"></a>
</p>

![Reviewing a transcript: suggested fixes in gold and purple](docs/screenshots/review.png)

## What it does

- **Drop in videos**: every audio track is pulled out, even multicam.
- **Transcribe** with Grok, Deepgram, AssemblyAI, ElevenLabs or OpenAI (your own API key).
- **Catch mistakes** like "couples stone" → **Cobblestone** with term lists, AI proofread and a second opinion.
- **Learns your fixes**: ones you keep making become one-click **Usually this**.
- **Export .srt files** next to your videos. Your originals are never touched.

## Get started

1. [Download](https://github.com/nicovald/Video-Transcribing/releases/latest) and run the installer. Windows may warn it's unsigned: **More info → Run anyway**.
2. **Settings → Transcription**: paste an API key and save.
3. Drop a video, pick the tracks, hit **Transcribe**.
4. Review the flagged lines, then **Save next to the videos**.

It updates itself.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/project.png" alt="Naming tracks and picking a provider"><br><sub><b>Name your tracks, pick a service</b></sub></td>
    <td width="50%"><img src="docs/screenshots/subtitles.png" alt="Subtitle layout with live preview"><br><sub><b>Tune subtitles with a live preview</b></sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/term-lists.png" alt="Building a term list with any AI"><br><sub><b>Build term lists for any game with AI</b></sub></td>
    <td width="50%"><img src="docs/screenshots/progress.png" alt="Transcription progress steps"><br><sub><b>See exactly what it's doing</b></sub></td>
  </tr>
</table>

<sub>Screenshots use demo data.</sub>

## More

- [User guide](docs/GUIDE.md): every feature, providers, team setup, where your data lives
- [Development](docs/DEVELOPMENT.md): run from source, Docker, API, how it works
- [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/nicovald/Video-Transcribing/issues)

The app is free and [MIT licensed](LICENSE). You pay your speech-to-text service directly. Bundled FFmpeg and other tools have their own licenses: see [third-party notices](THIRD_PARTY_NOTICES.md).
