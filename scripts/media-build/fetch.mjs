import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const config = JSON.parse(fs.readFileSync('scripts/media-build/sources.json', 'utf8'));
const dir = 'release/media-build/source-archives';
fs.mkdirSync(dir, { recursive: true });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const source of config.sources) {
  const file = path.join(dir, source.archive);
  if (fs.existsSync(file) && hash(file) === source.sha256) continue;
  const response = await fetch(source.url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`${source.name} source: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${file}.partial`));
  if (hash(`${file}.partial`) !== source.sha256) throw new Error(`${source.name} source checksum mismatch`);
  fs.renameSync(`${file}.partial`, file);
  console.log(`Verified ${source.name} ${source.version}`);
}
