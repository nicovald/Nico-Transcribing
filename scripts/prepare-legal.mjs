import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from './release-utils.mjs';
import { download } from './download-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const media = JSON.parse(fs.readFileSync('media-tools.lock.json', 'utf8'));
const out = 'build/legal';
fs.mkdirSync(out, { recursive: true });
const sections = [fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8'), `Nico's Transcriber\n\n${fs.readFileSync('LICENSE', 'utf8')}`];
const frontend = new Set(['react', 'react-dom', 'scheduler', '@fontsource-variable/baloo-2', '@fontsource-variable/plus-jakarta-sans']);
const missing = [];
let packageCount = 0;
for (const [directory, meta] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!directory || !directory.includes('node_modules/')) continue;
  const name = directory.split('node_modules/').at(-1);
  if (meta.dev && !frontend.has(name)) continue;
  if (!fs.existsSync(directory)) { if (meta.optional) continue; throw new Error(`Install dependencies before preparing notices: ${name}`); }
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const files = fs.readdirSync(directory).filter(file => /^(license|licence|copying|notice|copyright)(\.|-|$)/i.test(file) && fs.statSync(path.join(directory, file)).isFile());
  const fallback = path.join('licenses', `${name.replaceAll('/', '-')}-${pkg.version}.txt`);
  if (!files.length && !fs.existsSync(fallback)) { missing.push(name); continue; }
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || pkg.homepage || '';
  const text = files.length ? files.map(file => `${file}\n${fs.readFileSync(path.join(directory, file), 'utf8')}`).join('\n\n') : fs.readFileSync(fallback, 'utf8');
  sections.push(`${name}@${pkg.version}\nLicense: ${pkg.license || meta.license || 'see below'}\nSource: ${repository}\n\n${text}`);
  packageCount++;
}
if (missing.length) throw new Error(`License texts need review for: ${missing.join(', ')}`);
sections.push(`FFmpeg and ffprobe ${media.version}\n\n${fs.readFileSync('vendor/ffmpeg/LICENSE', 'utf8')}`);
for (const name of media.notices || []) {
  if (!name.endsWith('.txt')) continue;
  const file = path.join('vendor/ffmpeg', name);
  sections.push(`${name}\n\n${fs.readFileSync(file, 'utf8')}`);
  fs.copyFileSync(file, path.join(out, name));
}
fs.copyFileSync('vendor/ffmpeg/README.txt', `${out}/FFmpeg-build-details.txt`);
fs.copyFileSync('vendor/ffmpeg/LICENSE', `${out}/FFmpeg-LICENSE.txt`);
fs.rmSync(`${out}/FFmpeg-GPL-3.0.txt`, { force: true });
fs.copyFileSync('LICENSE', `${out}/LICENSE.txt`);
fs.copyFileSync('THIRD_PARTY_NOTICES.md', `${out}/THIRD_PARTY_NOTICES.md`);
fs.writeFileSync(`${out}/THIRD-PARTY-LICENSES.txt`, sections.join('\n\n' + '='.repeat(80) + '\n\n') + '\n');
console.log(`Prepared notices for ${packageCount} dependency packages, the app and media tools.`);

if (process.argv.includes('--sources')) {
  const target = `release/sources/${media.sourceFile || `ffmpeg-${media.version}-source.tar.gz`}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target) || digest(target) !== media.sourceSha256) {
    await download(media.sourceUrl, `${target}.partial`);
    if (digest(`${target}.partial`) !== media.sourceSha256) throw new Error('FFmpeg source checksum mismatch.');
    fs.renameSync(`${target}.partial`, target);
  }
  console.log(`Verified matching FFmpeg source: ${target}`);
}
