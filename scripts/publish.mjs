// Uploads the built installer to a GitHub release with the gh CLI.
// (electron-builder's own uploader races itself and leaves releases half-uploaded.)
// Run via: npm run release
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const { owner, repo } = pkg.build.publish[0];
const tag = `v${pkg.version}`;
const exe = `release/Grok-Transcriber-Setup-${pkg.version}.exe`;
const files = [exe, `${exe}.blockmap`, 'release/latest.yml'];

for (const f of files) if (!fs.existsSync(f)) throw new Error(`Missing ${f}. Did the build run?`);
if (!fs.readFileSync('release/latest.yml', 'utf8').includes(`version: ${pkg.version}`)) {
  throw new Error(`release/latest.yml is not for ${pkg.version}`);
}

const gh = (...args) => execFileSync('gh', [...args, '-R', `${owner}/${repo}`], { stdio: 'inherit' });
gh('release', 'create', tag, ...files, '--title', pkg.version, '--generate-notes', '--target', 'main');
console.log(`Published ${tag}. Installed apps will pick it up within a few hours (or via Settings → Updates → Check now).`);
