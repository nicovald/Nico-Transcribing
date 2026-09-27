import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertReleaseState, digest, releaseNotes, verifyUpdateMetadata } from './release-utils.mjs';

test('release rejects uncommitted, unpushed, wrong-branch, reused and mismatched versions', () => {
  const valid = { status: '', branch: 'main', head: 'abc', remoteHead: 'abc', version: '1.2.3', lockVersion: '1.2.3', tagExists: false };
  assert.doesNotThrow(() => assertReleaseState(valid));
  for (const patch of [{ status: ' M server/index.js' }, { status: '?? secret.env' }, { branch: 'feature' }, { remoteHead: 'def' }, { lockVersion: '1.2.2' }, { version: '1.2.3-beta' }, { tagExists: true }]) {
    assert.throws(() => assertReleaseState({ ...valid, ...patch }));
  }
});

test('release notes select only the exact version and require real notes', () => {
  const text = '# Changelog\n\n## 1.2.30 (2026-09-27)\n- Other\n\n## 1.2.3 (2026-09-26)\n- Fixed import\n\n## 1.2.2 (2026-09-25)\n- Older\n';
  assert.equal(releaseNotes(text, '1.2.3'), '## 1.2.3 (2026-09-26)\n- Fixed import');
  assert.throws(() => releaseNotes(text, '1.2.4'));
  assert.throws(() => releaseNotes('## 1.2.3 (2026-09-27)\n', '1.2.3'));
});

test('updater verification rejects a tampered installer, stale version, filename and size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verify-'));
  try {
    const installer = path.join(dir, 'Setup-1.2.3.exe');
    fs.writeFileSync(installer, 'fixture installer');
    const checksum = digest(installer, 'sha512', 'base64');
    const yaml = `version: 1.2.3\nfiles:\n  - url: Setup-1.2.3.exe\n    sha512: ${checksum}\n    size: 17\npath: Setup-1.2.3.exe\nsha512: ${checksum}\n`;
    assert.doesNotThrow(() => verifyUpdateMetadata(yaml, '1.2.3', installer));
    for (const bad of [yaml.replace('version: 1.2.3', 'version: 1.2.30'), yaml.replace('path: Setup', 'path: Other'), yaml.replace('size: 17', 'size: 18'), yaml.replace('- url: Setup', '- url: Other')]) assert.throws(() => verifyUpdateMetadata(bad, '1.2.3', installer));
    fs.appendFileSync(installer, 'changed');
    assert.throws(() => verifyUpdateMetadata(yaml, '1.2.3', installer));
  } finally {
    if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith('release-verify-')) throw new Error('Unexpected fixture path');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
