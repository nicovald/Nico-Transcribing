import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { digest } from './release-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const media = JSON.parse(fs.readFileSync('media-tools.lock.json', 'utf8'));
const out = 'build/legal';
fs.mkdirSync(out, { recursive: true });
const sections = [fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8'), `Nico's Transcriber\n\n${fs.readFileSync('LICENSE', 'utf8')}`];
const frontend = new Set(['react', 'react-dom', 'scheduler', '@fontsource-variable/baloo-2', '@fontsource-variable/plus-jakarta-sans']);
const missing = [];
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
}
if (missing.length) throw new Error(`License texts need review for: ${missing.join(', ')}`);
sections.push(`FFmpeg and ffprobe ${media.version} (GPL v3)\n\n${fs.readFileSync('vendor/ffmpeg/LICENSE', 'utf8')}`);
fs.copyFileSync('vendor/ffmpeg/README.txt', `${out}/FFmpeg-build-details.txt`);
fs.copyFileSync('vendor/ffmpeg/LICENSE', `${out}/FFmpeg-GPL-3.0.txt`);
fs.copyFileSync('LICENSE', `${out}/LICENSE.txt`);
fs.copyFileSync('THIRD_PARTY_NOTICES.md', `${out}/THIRD_PARTY_NOTICES.md`);
fs.writeFileSync(`${out}/THIRD-PARTY-LICENSES.txt`, sections.join('\n\n' + '='.repeat(80) + '\n\n') + '\n');
console.log(`Prepared notices for ${sections.length - 3} dependency packages, the app and FFmpeg.`);

if (process.argv.includes('--sources')) {
  const target = `release/sources/ffmpeg-${media.version}-source.tar.gz`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target) || digest(target) !== media.sourceSha256) {
    const response = await fetch(media.sourceUrl, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`FFmpeg source download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${target}.partial`));
    if (digest(`${target}.partial`) !== media.sourceSha256) throw new Error('FFmpeg source checksum mismatch.');
    fs.renameSync(`${target}.partial`, target);
  }
  console.log(`Verified matching FFmpeg source: ${target}`);
}
