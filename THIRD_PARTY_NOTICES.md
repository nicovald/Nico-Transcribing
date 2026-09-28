# Third-party software

Nico's Transcriber source code is MIT licensed; see [LICENSE](LICENSE).
Bundled dependencies retain their own copyrights and licenses.

## FFmpeg and ffprobe

The Windows installer includes **FFmpeg and ffprobe 9.0.2-nicos2**, built from
unmodified FFmpeg sources with only LAME 3.100 and zlib 1.3.2 enabled as optional
third-party libraries. FFmpeg uses LGPL-2.1-or-later, LAME uses LGPL-2.0-or-later,
and zlib uses the zlib license. GPL, nonfree and version-3-only features are
disabled. They run as separate programs and retain their own licenses.

- Binary archive, source revision and SHA-256 hashes: [media-tools.lock.json](media-tools.lock.json).
- FFmpeg source: [revision 946fcce07b6dcd0331c8cc609192aeff5e1924f8](https://github.com/FFmpeg/FFmpeg/tree/946fcce07b6dcd0331c8cc609192aeff5e1924f8).
- Each app release from 0.17.2 includes `ffmpeg-9.0.2-nicos2-source.tar.gz`: the
  exact FFmpeg, LAME and zlib source archives, hashes, build scripts, generated
  configuration, toolchain versions and Windows runtime notices. The compiler
  runtime notices include the applicable GCC Runtime Library Exception.
- Build instructions: [scripts/media-build/README.md](scripts/media-build/README.md).
  The build runs in the **Build media tools** GitHub Actions workflow.
- License text: `resources/media-tools/LICENSE` and
  `resources/licenses/FFmpeg-LICENSE.txt` in the installed app. LAME, zlib and
  compiler runtime notices are in the same directory and the combined notices.
- Build configuration: `resources/media-tools/README.txt`; exact binary hashes:
  `resources/media-tools/provenance.json`. `BUILD-PROVENANCE.json` identifies
  the media-tools build commit separately from the app release commit.

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
