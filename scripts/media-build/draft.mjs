// Store verified build outputs as a draft release; publication follows Windows validation.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const { build } = JSON.parse(fs.readFileSync('scripts/media-build/sources.json', 'utf8'));
const repository = process.env.GITHUB_REPOSITORY;
const commit = process.env.GITHUB_SHA;
if (!repository || !commit) throw new Error('Run this from the media-tools workflow.');
const tag = `media-tools-${build}`;
const folder = 'release/media-build/artifacts';
const files = fs.readdirSync(folder).sort().map(name => path.join(folder, name));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expected = Object.fromEntries(files.map(file => [path.basename(file), hash(file)]));
const gh = args => execFileSync('gh', args, { encoding: 'utf8' });
gh(['release', 'create', tag, ...files, '--repo', repository, '--target', commit, '--draft', '--prerelease', '--latest=false', '--title', `Media tools ${build}`, '--notes-file', 'scripts/media-build/README.md']);
const { assets } = JSON.parse(gh(['release', 'view', tag, '--repo', repository, '--json', 'assets']));
for (const [name, sha] of Object.entries(expected)) {
  const asset = assets.find(a => a.name === name);
  if (!asset || asset.state !== 'uploaded' || asset.digest !== `sha256:${sha}`) throw new Error(`Draft retained: asset verification failed for ${name}`);
}
console.log(`Draft ${tag}: all uploaded asset digests verified. Validate on Windows before publishing.`);
