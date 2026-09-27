import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FFMPEG } from './media-tools.js';
import { prepareAudio, probe } from './ffmpeg.js';

test('media tools encode cleaned audio as FLAC and MP3 with usable timing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'media-codec-test-'));
  try {
    const source = path.join(directory, 'source.wav');
    const generated = spawnSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-ac', '2', source], { windowsHide: true });
    assert.equal(generated.status, 0, String(generated.stderr));
    for (const codec of ['flac', 'mp3']) {
      const output = path.join(directory, `cleaned.${codec}`);
      await prepareAudio(source, output, { cleanup: true, start: 1, length: 2, codec });
      const info = await probe(output);
      assert.equal(info.tracks.length, 1);
      assert.equal(info.tracks[0].codec, codec);
      assert.equal(info.tracks[0].channels, 1);
      assert.equal(info.tracks[0].sampleRate, 16000);
      assert.ok(info.duration >= 1.9 && info.duration < 2.3, `${codec}: ${info.duration}`);
    }
  } finally {
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('media-codec-test-')) throw new Error('Unexpected test directory');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
