# Releasing Nico's Transcriber

Release on Windows x64 with Node.js 22.19+ and an authenticated GitHub CLI.
The package version is the source of truth for the UI, API and installer.

## Prepare

1. Make the changes and update `CHANGELOG.md` with a dated, user-facing entry.
2. Use `npm version patch --no-git-tag-version` (or `minor` / `major`) to update
   both `package.json` and `package-lock.json`.
3. Run `npm ci`, `npm test` and `npm run build`. For UI changes, run
   `node scripts/desktop-smoke.mjs` and inspect the screenshots printed at the end.
4. Commit and push everything to `main`. Confirm the **Verify** workflow passes.
5. Run `npm run release:check`. This only reads local Git and GitHub metadata.
6. Run `npm run release`.

To check an upgrade before publishing, preserve the previous unpacked app and run
`npm run release -- --previous "release/previous/Nicos Transcriber.exe"`.
This adds the isolated saved-data upgrade check to the release gate and provenance.

The release command requires a clean working tree, local HEAD equal to GitHub's
current `main`, matching package/lockfile versions, a changelog entry, and an
unused version tag. It installs from the lockfile, runs tests, builds the
installer, extracts its payload and compares every file with the packaged app,
then runs the smoke suite against the **extracted installer executable**. Before
uploading, it also requires a successful **Verify** workflow for that exact commit
(waiting up to ten minutes for CI to finish).

It verifies `latest.yml` against the installer's SHA-512 and size, writes
`SHA256SUMS.txt` and `build-provenance.json`, and creates a **draft** release
targeting the exact tested commit. Only after every uploaded asset's SHA-256
matches GitHub's digest does it publish the release as latest.

This command never changes repository visibility. In a private repository,
only authorized users can download releases; the app needs their read-only
GitHub token for updates.

## Failed releases

A failure before draft creation leaves local build files only. An upload or
verification failure leaves the GitHub release as a draft. Inspect the error
and the draft assets; do not manually publish an incomplete update.

For a fresh retry, remove only the failed **draft** (and its tag if GitHub created
one), after confirming no published release uses that version. Then rerun the
full command. Published releases and their tags must never be overwritten;
fix forward with a new patch version.

## Media tools and notices

`media-tools.lock.json` pins the Windows archive, matching media-tools source bundle
and both archive checksums. `npm ci` installs the verified binaries into ignored
`vendor/ffmpeg/`; the installer copies them outside `app.asar` into
`resources/media-tools/`. While the repository is private, the download uses an
authenticated GitHub CLI; public downloads need no login. CI downloads the tools
before `npm ci`, with repository read access scoped to that download step.

To update them, change the pinned inputs in `scripts/media-build/sources.json`,
then run the **Build media tools** workflow. See its [build instructions](../scripts/media-build/README.md).
The workflow creates a draft release with both archives and verified upload hashes.
Download and validate them on Windows, publish that draft as a prerelease
(not latest), and update the manifest with its URLs and hashes. Run
`npm run media:install` and test import, FLAC extraction, voice cleanup and MP3
encoding before releasing the app. Keep the source bundle alongside every app
installer that distributes those binaries.

`npm run legal` gathers the exact installed dependency and font license texts.
Missing texts fail the build; versioned upstream copies for packages that omit
their licenses live in `licenses/`. Electron supplies its own Chromium notices.
`node scripts/prepare-legal.mjs --sources` verifies the source bundle, which is
uploaded beside the installer. It includes FFmpeg, LAME and zlib sources plus
build scripts, generated configuration, toolchain versions and runtime notices.

## Before the public launch

- Try a clean install and an upgrade from the previous release in a disposable
  Windows account or VM. Check that projects, presets and saved keys survive.
  `node scripts/upgrade-smoke.mjs <old.exe> <new.exe>` also verifies saved-data
  compatibility in an isolated profile; it does not exercise the NSIS wizard.
- Transcribe a short, non-sensitive clip with each provider being advertised,
  review it and open the exported SRT in an editor. These paid calls are not part
  of the automated suite.
- If code signing is configured, set electron-builder's signing credentials
  through the environment; never commit them. Otherwise retain the unsigned
  installer notice in the README and release notes.
- When ready, change repository visibility yourself and check the download link
  and updater while signed out.

## Screenshots

Use only the synthetic data from `scripts/desktop-smoke.mjs`. Copy these from the
newly printed artifact directory into `docs/screenshots/`: `review.png`,
`home.png` (as `projects.png`), `project.png`, `subtitles.png` and `aiterms.png`
(as `term-lists.png`). Don't use `export.png` (it shows local paths) or
`learned.png` (it shows the people list). Inspect every image before committing.
Never use real keys, source paths or customer projects.
