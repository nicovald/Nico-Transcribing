// Preflight -> test -> build -> packaged smoke -> draft -> verify -> publish.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseState, digest, releaseNotes, verifyUpdateMetadata } from './release-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const { owner, repo } = pkg.build.publish[0];
const repository = `${owner}/${repo}`;
const tag = `v${pkg.version}`;
const read = (command, args) => execFileSync(command, args, { encoding: 'utf8', windowsHide: true }).trim();
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit', windowsHide: true });
const gh = (...args) => read('gh', args);
const git = (...args) => read('git', args);
const head = git('rev-parse', 'HEAD');
const changelog = releaseNotes(fs.readFileSync('CHANGELOG.md', 'utf8'), pkg.version);

function preflight() {
  // Read GitHub directly: a stale origin/main ref is not sufficient.
  const remoteHead = gh('api', `repos/${repository}/commits/main`, '--jq', '.sha');
  const tags = JSON.parse(gh('api', `repos/${repository}/git/matching-refs/tags/${tag}`));
  assertReleaseState({ status: git('status', '--porcelain', '--untracked-files=all'), branch: git('branch', '--show-current'), head: git('rev-parse', 'HEAD'), remoteHead, version: pkg.version, lockVersion: lock.version, tagExists: tags.some(t => t.ref === `refs/tags/${tag}`) || Boolean(git('tag', '--list', tag)) });
  if (git('rev-parse', 'HEAD') !== head) throw new Error('HEAD changed during release preparation.');
  if (lock.packages[''].version !== pkg.version) throw new Error('The package-lock root version differs.');
}

preflight();
console.log(`Preflight passed: ${repository} ${tag} at ${head}.`);
if (process.argv.includes('--check')) process.exit(0);
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build Windows releases on Windows x64.');
if (!process.env.npm_execpath) throw new Error('Run this script with npm run release.');
const npm = (...args) => run(process.execPath, [process.env.npm_execpath, ...args]);
// Release checks must exercise the bundled binaries, regardless of developer overrides.
delete process.env.FFMPEG_PATH;
delete process.env.FFPROBE_PATH;
// Install the committed lockfile and pinned tools before testing and packaging.
npm('ci');
npm('test');
npm('run', 'dist');
const binaryProvenance = JSON.parse(fs.readFileSync('vendor/ffmpeg/provenance.json', 'utf8'));
for (const [relative, hash] of Object.entries(binaryProvenance.binaries)) {
  if (digest(path.join('release/win-unpacked/resources/media-tools', relative)) !== hash) throw new Error(`Packaged media tool differs: ${relative}`);
}
run(process.execPath, ['scripts/desktop-smoke.mjs', `release/win-unpacked/${pkg.build.executableName}.exe`]);
run(process.execPath, ['scripts/prepare-legal.mjs', '--sources']);

const installer = `release/${pkg.build.artifactName.replace('${version}', pkg.version).replace('${ext}', 'exe')}`;
const media = JSON.parse(fs.readFileSync('media-tools.lock.json', 'utf8'));
const files = [installer, `${installer}.blockmap`, 'release/latest.yml', `release/sources/ffmpeg-${media.version}-source.tar.gz`, 'build/legal/THIRD-PARTY-LICENSES.txt', 'build/legal/FFmpeg-build-details.txt', 'THIRD_PARTY_NOTICES.md'];
for (const file of files) if (!fs.existsSync(file)) throw new Error(`Missing release asset: ${file}`);
verifyUpdateMetadata(fs.readFileSync('release/latest.yml', 'utf8'), pkg.version, installer);
const checksums = Object.fromEntries(files.map(file => [path.basename(file), digest(file)]));
const provenance = { version: pkg.version, commit: head, media, checks: ['automated tests', 'production build', 'packaged desktop smoke'], assets: checksums };
fs.writeFileSync('release/build-provenance.json', JSON.stringify(provenance, null, 2) + '\n');
files.push('release/build-provenance.json');
fs.writeFileSync('release/SHA256SUMS.txt', files.map(file => `${digest(file)}  ${path.basename(file)}`).join('\n') + '\n');
files.push('release/SHA256SUMS.txt');
fs.writeFileSync('release/release-notes.md', `${changelog}\n\n### Install\n\nDownload **${path.basename(installer)}** below for Windows 10/11 x64. The installer is unsigned; Windows may show a SmartScreen warning. Bring your own transcription API key; provider usage is billed separately.\n\nExisting installations keep their local projects and settings. Public releases need no update token; private repositories require access.\n\n### Verification and source\n\nSHA256SUMS.txt contains the asset checksums; build-provenance.json identifies the tested commit. The FFmpeg source archive, build details and third-party notices are included below. The source archive covers FFmpeg itself; external-library versions are recorded in FFmpeg-build-details.txt.\n`);

// Fail before creating anything remotely if files changed during the build.
preflight();
const expected = Object.fromEntries(files.map(file => [path.basename(file), digest(file)]));
run('gh', ['release', 'create', tag, ...files, '--repo', repository, '--draft', '--target', head, '--title', `Nico's Transcriber ${pkg.version}`, '--notes-file', 'release/release-notes.md']);
// Keep a failed/incomplete upload as a draft; never expose a partial updater release.
const uploaded = JSON.parse(gh('release', 'view', tag, '--repo', repository, '--json', 'assets')).assets;
for (const [name, hash] of Object.entries(expected)) {
  const asset = uploaded.find(a => a.name === name);
  if (!asset || asset.state !== 'uploaded' || asset.digest !== `sha256:${hash}`) throw new Error(`Draft retained: GitHub checksum verification failed for ${name}.`);
}
run('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']);
console.log(`Published ${tag} from ${head}. Repository visibility was not changed.`);
