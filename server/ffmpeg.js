// Thin wrappers around the bundled ffmpeg/ffprobe binaries.
import { spawn } from 'node:child_process';
import { FFMPEG, FFPROBE } from './media-tools.js';

// Speech-band filter for noisy gaming/commentary audio: cut rumble and hiss,
// then even out loudness so quiet talkers are not lost under game audio.
const VOICE_CLEANUP = 'highpass=f=80,lowpass=f=8000,afftdn=nf=-25,dynaudnorm=f=150:g=15';

function run(bin, args, { onStderr, signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const proc = spawn(bin, args, { windowsHide: true });
    const abort = () => proc.kill();
    signal?.addEventListener('abort', abort, { once: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 20000) stderr = stderr.slice(-10000);
      onStderr?.(String(d));
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason);
      else if (code === 0) resolve(stdout);
      else reject(new Error(`${bin.split(/[\\/]/).pop()} exited with code ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

// Returns { duration, tracks: [{ index, streamIndex, codec, channels, sampleRate, language, title }] }
export async function probe(file, { signal } = {}) {
  const out = await run(FFPROBE, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ], { signal });
  const info = JSON.parse(out);
  const origin = Number(info.streams?.find(s => s.codec_type === 'video')?.start_time ?? info.format?.start_time) || 0;
  const tracks = (info.streams || []).filter(s => s.codec_type === 'audio').map((s, i) => ({
    index: i,
    streamIndex: s.index,
    codec: s.codec_name,
    channels: s.channels,
    channelLayout: s.channel_layout || '',
    sampleRate: Number(s.sample_rate) || null,
    language: s.tags?.language && s.tags.language !== 'und' ? s.tags.language : '',
    title: s.tags?.title || s.tags?.handler_name?.replace(/^\s*(SoundHandler|Core Media Audio)\s*$/i, '') || '',
    duration: Number(s.duration) || null,
    startOffset: (Number(s.start_time) || 0) - origin,
  }));
  return { duration: Number(info.format?.duration) || null, tracks };
}

// "00:01:23.45" -> 83.45
const parseTime = (t) => t.split(':').reduce((acc, v) => acc * 60 + Number(v), 0);

// Extract one audio track (0-based audio index) as 16 kHz mono FLAC.
export function extractTrack(input, audioIndex, output, { duration, onProgress, startOffset = 0, signal } = {}) {
  const alignment = startOffset < 0
    ? `atrim=start=${-startOffset},asetpts=PTS-STARTPTS`
    : `asetpts=PTS-STARTPTS,adelay=${Math.round(startOffset * 1000)}:all=1`;
  return run(
    FFMPEG,
    ['-y', '-hide_banner', '-i', input, '-map', `0:a:${audioIndex}`, '-vn', '-af', alignment, '-ac', '1', '-ar', '16000', '-c:a', 'flac', output],
    {
      signal,
      onStderr: (chunk) => {
        const m = /time=(\d+:\d+:\d+\.\d+)/.exec(chunk);
        if (m && duration && onProgress) onProgress(Math.min(1, parseTime(m[1]) / duration));
      },
    },
  );
}

// Prepare audio for upload: optional voice cleanup, optional time range, chosen codec.
// codec: 'flac' (lossless, default) or 'mp3' (small, for size-limited APIs).
export function prepareAudio(input, output, { cleanup = false, start, length, codec = 'flac', signal } = {}) {
  const args = ['-y', '-hide_banner'];
  if (start != null) args.push('-ss', String(start));
  args.push('-i', input);
  if (length != null) args.push('-t', String(length));
  if (cleanup) args.push('-af', VOICE_CLEANUP);
  args.push('-ac', '1', '-ar', '16000');
  if (codec === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '48k');
  else args.push('-c:a', 'flac');
  args.push(output);
  return run(FFMPEG, args, { signal });
}
