import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const work = path.resolve('release/media-build');
const output = path.join(work, 'output', 'ffmpeg-9.0.2-nicos2');
const source = path.join(work, 'source-package');
const read = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const config = JSON.parse(fs.readFileSync('scripts/media-build/sources.json', 'utf8'));
const report = read('dpkg-query', ['-W', 'gcc-mingw-w64-x86-64*', 'g++-mingw-w64-x86-64*', 'mingw-w64*', 'binutils-mingw-w64-x86-64', 'nasm', 'make', 'pkg-config']);
fs.writeFileSync(path.join(source, 'toolchain.txt'), `${report}\n${read('x86_64-w64-mingw32-gcc', ['--version'])}`);
// Video for Windows uses Avicap32/Avifil32/Msvfw32 DLLs; Vfw32 is the import-library name.
const systemDlls = new Set(['advapi32.dll','avicap32.dll','avifil32.dll','bcrypt.dll','crypt32.dll','gdi32.dll','kernel32.dll','msvcrt.dll','msvfw32.dll','ntdll.dll','ole32.dll','oleaut32.dll','psapi.dll','secur32.dll','shell32.dll','shlwapi.dll','user32.dll','uuid.dll','winmm.dll','ws2_32.dll']);
const binaries = {};
for (const name of ['ffmpeg', 'ffprobe']) {
  const file = path.join(output, 'bin', `${name}.exe`);
  const imports = read('x86_64-w64-mingw32-objdump', ['-p', file]);
  const dlls = [...imports.matchAll(/DLL Name:\s*(\S+)/g)].map(m => m[1].toLowerCase());
  fs.writeFileSync(path.join(source, `${name}-imports.txt`), imports);
  console.log(`${name} imports: ${dlls.join(', ')}`);
  const unexpected = dlls.filter(dll => !systemDlls.has(dll));
  if (unexpected.length) throw new Error(`Unexpected external runtime DLLs: ${unexpected.join(', ')}`);
  binaries[`bin/${name}.exe`] = hash(file);
}
let compilerNotices = '';
for (const name of ['gcc-mingw-w64-base','mingw-w64-common','mingw-w64-x86-64-dev']) {
  const file = `/usr/share/doc/${name}/copyright`;
  if (!fs.existsSync(file)) throw new Error(`Missing compiler runtime notice: ${file}`);
  compilerNotices += `${name}\n\n${fs.readFileSync(file, 'utf8')}\n\n`;
}
fs.writeFileSync(path.join(output, 'TOOLCHAIN-NOTICES.txt'), compilerNotices);
fs.writeFileSync(path.join(source, 'TOOLCHAIN-NOTICES.txt'), compilerNotices);
fs.copyFileSync('scripts/media-build/package.mjs', path.join(source, 'package.mjs'));
fs.copyFileSync('scripts/media-build/README.md', path.join(output, 'README.txt'));
// A standalone source-bundle rebuild does not need a Git checkout.
let commit = null;
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
const provenance = { ...config, commit, binaries };
fs.writeFileSync(path.join(output, 'BUILD-PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n');
fs.writeFileSync(path.join(source, 'BUILD-PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n');
fs.mkdirSync(path.join(work, 'artifacts'), { recursive: true });
execFileSync('zip', ['-qr', path.join(work, 'artifacts', 'ffmpeg-9.0.2-nicos2-win64.zip'), 'ffmpeg-9.0.2-nicos2'], { cwd: path.join(work, 'output') });
execFileSync('tar', ['-czf', path.join(work, 'artifacts', 'ffmpeg-9.0.2-nicos2-source.tar.gz'), '-C', work, 'source-package']);
const checksums = fs.readdirSync(path.join(work, 'artifacts')).filter(name => name !== 'SHA256SUMS.txt').sort().map(name => `${hash(path.join(work, 'artifacts', name))}  ${name}`);
fs.writeFileSync(path.join(work, 'artifacts', 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
console.log(checksums.join('\n'));
