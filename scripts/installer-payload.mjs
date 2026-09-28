// Verify what is actually compressed into the installer, without installing into the user's account.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js';
import { digest } from './release-utils.mjs';

export async function extractVerifiedInstaller(installer, reference) {
  const parent = path.resolve('release/installer-check');
  fs.mkdirSync(parent, { recursive: true });
  const output = fs.mkdtempSync(path.join(parent, 'payload-'));
  const sevenZip = await getPath7za();
  execFileSync(sevenZip, ['x', path.resolve(installer), `-o${output}`, '-y'], { windowsHide: true, stdio: 'pipe' });
  let count = 0;
  function compare(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) { compare(path.join(directory, entry.name), relative); continue; }
      if (!entry.isFile()) throw new Error(`Unexpected packaged entry: ${relative}`);
      const extracted = path.join(output, relative);
      if (!fs.existsSync(extracted) || digest(extracted) !== digest(path.join(directory, entry.name))) {
        throw new Error(`Installer payload differs from the packaged app: ${relative}`);
      }
      count++;
    }
  }
  compare(path.resolve(reference));
  console.log(`Verified ${count} installer payload files against the packaged app.`);
  return output;
}
