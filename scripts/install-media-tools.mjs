// Downloads one pinned Windows build containing BOTH tools. No credentials needed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'media-tools.lock.json'), 'utf8'));
const destination = path.join(root, 'vendor', 'ffmpeg');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

if (process.platform !== 'win32') {
  console.log('Media tools: use system ffmpeg and ffprobe (or FFMPEG_PATH / FFPROBE_PATH).');
} else {
  if (process.arch !== 'x64') throw new Error('The Windows desktop build requires x64 Node.js.');
  fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
  const archive = path.join(root, 'vendor', 'ffmpeg-download.zip');
  if (!fs.existsSync(archive) || hash(archive) !== lock.sha256) {
    console.log(`Downloading FFmpeg + ffprobe ${lock.version}…`);
    const response = await fetch(lock.url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`Media download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${archive}.partial`));
    if (hash(`${archive}.partial`) !== lock.sha256) throw new Error('Media archive checksum mismatch. Nothing was installed.');
    fs.renameSync(`${archive}.partial`, archive);
  }
  // The archive is verified on every run, and files are restored from that archive.
  const stage = fs.mkdtempSync(path.join(root, 'vendor', 'ffmpeg-stage-'));
  try {
    const files = ['bin/ffmpeg.exe', 'bin/ffprobe.exe', 'LICENSE', 'README.txt'];
    execFileSync('tar', ['-xf', archive, '-C', stage, '--strip-components=1', ...files.map(file => `${lock.directory}/${file}`)], { windowsHide: true });
    const binaries = {};
    for (const name of ['ffmpeg', 'ffprobe']) {
      const relative = `bin/${name}.exe`;
      const version = execFileSync(path.join(stage, relative), ['-version'], { encoding: 'utf8', windowsHide: true });
      if (!version.startsWith(`${name} version ${lock.version}-`)) throw new Error(`Unexpected ${name} version.`);
      binaries[relative] = hash(path.join(stage, relative));
    }
    fs.mkdirSync(destination, { recursive: true });
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(destination, file)), { recursive: true });
      fs.copyFileSync(path.join(stage, file), path.join(destination, file));
    }
    fs.writeFileSync(path.join(destination, 'provenance.json'), JSON.stringify({ ...lock, binaries }, null, 2) + '\n');
    console.log(`Verified FFmpeg + ffprobe ${lock.version}.`);
  } finally {
    // mkdtemp created this exact directory inside our workspace's vendor folder.
    if (path.dirname(stage) !== path.join(root, 'vendor')) throw new Error('Unexpected extraction path.');
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
