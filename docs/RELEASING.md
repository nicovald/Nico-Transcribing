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

The release command requires a clean working tree, local HEAD equal to GitHub's
current `main`, matching package/lockfile versions, a changelog entry, and an
unused version tag. It installs from the lockfile, runs tests, builds the
installer and runs the smoke suite against the **packaged executable**.

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

`media-tools.lock.json` pins the Windows archive, matching FFmpeg source revision
and both archive checksums. `npm ci` installs the verified binaries into ignored
`vendor/ffmpeg/`; the installer copies them outside `app.asar` into
`resources/media-tools/`. To update them, inspect a maintained upstream release,
verify its checksums, update the manifest, run `npm run media:install`, and test
real import, FLAC extraction, voice cleanup and MP3 encoding before release.

`npm run legal` gathers the exact installed dependency and font license texts.
Missing texts fail the build; versioned upstream copies for packages that omit
their licenses live in `licenses/`. Electron supplies its own Chromium notices.
`node scripts/prepare-legal.mjs --sources` verifies the matching FFmpeg source
archive, which is uploaded beside the installer.

The FFmpeg core archive does not include the upstream build's external libraries.
Their source completeness remains a pre-publication item documented in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md); do not describe the core archive
as the complete source for every compiled component.

## Before the public launch

- Finish the external-library source review described above.
- Try a clean install and an upgrade from the previous release in a disposable
  Windows account or VM. Check that projects, presets and saved keys survive.
- Transcribe a short, non-sensitive clip with each provider being advertised,
  review it and open the exported SRT in an editor. These paid calls are not part
  of the automated suite.
- If code signing is configured, set electron-builder's signing credentials
  through the environment; never commit them. Otherwise retain the unsigned
  installer notice in the README and release notes.
- When ready, change repository visibility yourself, remove the README's
  private-preview note, and check the download link and updater while signed out.

## Screenshots

Use only the synthetic data from `scripts/desktop-smoke.mjs`. Copy `review.png`
and `home.png` from the newly printed artifact directory to
`docs/screenshots/review.png` and `docs/screenshots/projects.png`. Inspect both
images before committing. Never use real keys, source paths or customer projects.
