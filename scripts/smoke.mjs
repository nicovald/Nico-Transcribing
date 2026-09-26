// Run after npm run build. Point DATA_DIR at disposable fixture data.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (!process.env.SCREENSHOT || !process.env.DATA_DIR) throw new Error('Set SCREENSHOT and DATA_DIR to isolated test paths.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executable = process.argv[2] || path.join(root, 'node_modules/electron/dist/electron.exe');
const child = spawn(executable, process.argv[2] ? [] : ['.'], { cwd: root, windowsHide: true, stdio: 'inherit', env });
child.on('error', err => { console.error(err.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
