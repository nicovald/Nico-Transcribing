import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Packaged tools stay outside app.asar, where users can replace them independently.
const directory = root.endsWith('app.asar')
  ? path.join(path.dirname(root), 'media-tools', 'bin')
  : path.join(root, 'vendor', 'ffmpeg', 'bin');

export const FFMPEG = process.env.FFMPEG_PATH || (process.platform === 'win32' ? path.join(directory, 'ffmpeg.exe') : 'ffmpeg');
export const FFPROBE = process.env.FFPROBE_PATH || (process.platform === 'win32' ? path.join(directory, 'ffprobe.exe') : 'ffprobe');
