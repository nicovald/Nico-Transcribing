# Third-party software

Nico's Transcriber source code is MIT licensed; see [LICENSE](LICENSE).
Bundled dependencies retain their own copyrights and licenses.

## FFmpeg and ffprobe

The Windows installer includes the unmodified **FFmpeg and ffprobe 9.0.2**
executables from [Gyan's essentials build](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2).
Both use the same GPL v3 build. They are separate programs invoked as child
processes; they are not part of the app's MIT license.

- Binary archive, source revision and SHA-256 hashes: [media-tools.lock.json](media-tools.lock.json).
- FFmpeg source: [revision 946fcce07b6dcd0331c8cc609192aeff5e1924f8](https://github.com/FFmpeg/FFmpeg/tree/946fcce07b6dcd0331c8cc609192aeff5e1924f8).
- Each new app release includes `ffmpeg-9.0.2-source.tar.gz`, the matching FFmpeg
  core source archive, and `FFmpeg-build-details.txt`, the upstream build README.
- The upstream build also includes external libraries. Their configured features
  and versions are recorded in the build README; the core source archive does
  **not** contain those libraries. The complete corresponding-source collection
  for the upstream build needs to be verified before a public binary launch.
- License text: `resources/media-tools/LICENSE` and
  `resources/licenses/FFmpeg-GPL-3.0.txt` in the installed app.
- Build configuration: `resources/media-tools/README.txt`; exact binary hashes:
  `resources/media-tools/provenance.json`.

The tools live in `resources/media-tools/bin/` outside the application archive.
You can replace them with compatible builds, or set `FFMPEG_PATH` and
`FFPROBE_PATH`. No binary patches have been applied. See
[FFmpeg's license information](https://ffmpeg.org/legal.html) for its terms.
Browser/Docker installations use the host distribution's FFmpeg package instead.

## JavaScript dependencies and fonts

The installer carries the license texts of runtime npm dependencies, React,
React DOM, Scheduler, and both bundled fonts in
`resources/licenses/THIRD-PARTY-LICENSES.txt`. You can also download the notices
from **Settings → App updates**. `npm run legal` regenerates this file from the
installed lockfile dependencies and stops if a license text is missing.

- Plus Jakarta Sans — SIL Open Font License 1.1; the Plus Jakarta Sans Project Authors.
- Baloo 2 — SIL Open Font License 1.1; the Baloo 2 Project Authors.
- Electron and Chromium notices are supplied by Electron as
  `LICENSE.electron.txt` and `LICENSES.chromium.html` beside the executable.

The app license does not override these third-party terms.
