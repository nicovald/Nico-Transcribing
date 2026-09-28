import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Public releases download anonymously; private previews can use an authenticated gh CLI.
export async function download(url, file) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (response.ok) {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file));
    return;
  }
  const parsed = new URL(url);
  const match = /^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/.exec(parsed.pathname);
  if (parsed.hostname === 'github.com' && match && [403, 404].includes(response.status)) {
    const [, owner, repo, tag, name] = match.map(decodeURIComponent);
    try {
      execFileSync('gh', ['release', 'download', tag, '--repo', `${owner}/${repo}`, '--pattern', name, '--output', file, '--clobber'], { stdio: 'inherit', windowsHide: true });
      return;
    } catch {
      throw new Error('The media-tools release is private. Authenticate gh with repository read access, then retry. Public downloads need no login.');
    }
  }
  throw new Error(`Download failed: HTTP ${response.status}`);
}
