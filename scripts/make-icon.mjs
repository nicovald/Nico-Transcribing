// Builds electron/icon.ico from electron/icon.png in the layout Windows reads everywhere:
// uncompressed 32-bit bitmaps for small sizes, PNG only for 256px.
// (electron-builder's own .ico uses PNG for every size, which Explorer can show as a blank icon.)
// Run: node scripts/make-icon.mjs   (needs ffmpeg on PATH)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SRC = 'electron/icon.png';
const OUT = 'electron/icon.ico';
const BMP_SIZES = [16, 20, 24, 32, 40, 48, 64];

const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', SRC, ...args], { maxBuffer: 64 << 20 });

function bmpEntry(size) {
  const bgra = ffmpeg(['-vf', `scale=${size}:${size}:flags=lanczos`, '-f', 'rawvideo', '-pix_fmt', 'bgra', '-']);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // header size
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND masks
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bpp
  // Pixel rows are stored bottom-up.
  const rows = [];
  for (let y = size - 1; y >= 0; y--) rows.push(bgra.subarray(y * size * 4, (y + 1) * size * 4));
  // AND mask: all zeros (alpha channel carries transparency), rows padded to 4 bytes.
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, ...rows, Buffer.alloc(maskRow * size)]);
}

const png256 = ffmpeg(['-vf', 'scale=256:256:flags=lanczos', '-f', 'image2pipe', '-vcodec', 'png', '-']);
const images = [...BMP_SIZES.map((s) => ({ size: s, data: bmpEntry(s) })), { size: 256, data: png256 }];

const dir = Buffer.alloc(6 + images.length * 16);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2); // type: icon
dir.writeUInt16LE(images.length, 4);
let offset = dir.length;
images.forEach(({ size, data }, i) => {
  const o = 6 + i * 16;
  dir[o] = size === 256 ? 0 : size;
  dir[o + 1] = size === 256 ? 0 : size;
  dir.writeUInt16LE(1, o + 4); // planes
  dir.writeUInt16LE(32, o + 6); // bpp
  dir.writeUInt32LE(data.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += data.length;
});

fs.writeFileSync(OUT, Buffer.concat([dir, ...images.map((i) => i.data)]));
console.log(`Wrote ${OUT} (${images.map((i) => i.size).join(', ')}px)`);
