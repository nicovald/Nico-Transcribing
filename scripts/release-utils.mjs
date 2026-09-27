import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const digest = (file, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);

export function assertReleaseState({ status, branch, head, remoteHead, version, lockVersion, tagExists }) {
  if (status.trim()) throw new Error('Commit or remove all working-tree changes before releasing.');
  if (branch !== 'main') throw new Error('Release from main.');
  if (head !== remoteHead) throw new Error('Local HEAD and GitHub main differ. Push or pull before releasing.');
  if (!/^\d+\.\d+\.\d+$/.test(version) || version !== lockVersion) throw new Error('package.json and package-lock.json must have the same stable version.');
  if (tagExists) throw new Error(`v${version} already exists. Bump the version; never replace an existing release.`);
}

export function releaseNotes(changelog, version) {
  const heading = `## ${version} (`;
  const start = changelog.indexOf(heading);
  if (start < 0) throw new Error(`Missing dated CHANGELOG entry for ${version}.`);
  const end = changelog.indexOf('\n## ', start + heading.length);
  const notes = changelog.slice(start, end < 0 ? undefined : end).trim();
  if (!notes.includes('\n- ')) throw new Error('The release needs user-facing changelog bullets.');
  return notes;
}

export function verifyUpdateMetadata(yaml, version, installer) {
  const fields = Object.fromEntries([...yaml.matchAll(/^(version|path|sha512):\s*(.+?)\s*$/gm)].map(([, key, value]) => [key, value]));
  if (fields.version !== version) throw new Error('latest.yml has the wrong version.');
  if (fields.path !== path.basename(installer)) throw new Error('latest.yml points to a different installer.');
  if (fields.sha512 !== digest(installer, 'sha512', 'base64')) throw new Error('latest.yml installer checksum does not match.');
  const entry = /- url:\s*(\S+)\s*\n\s+sha512:\s*(\S+)\s*\n\s+size:\s*(\d+)/.exec(yaml);
  if (!entry || entry[1] !== fields.path || entry[2] !== fields.sha512 || Number(entry[3]) !== fs.statSync(installer).size) throw new Error('latest.yml file entry is inconsistent.');
}
