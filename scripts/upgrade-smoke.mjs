// Checks old -> new data compatibility with fake credentials and an isolated Windows profile.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [previous, current] = process.argv.slice(2);
if (!previous || !current) throw new Error('Usage: node scripts/upgrade-smoke.mjs <previous.exe> <current.exe>');
const folder = path.join(root, 'data', 'upgrade-smoke', String(Date.now()));
fs.mkdirSync(folder, { recursive: true });
const state = path.join(folder, 'state');
async function capture(executable, name, script) {
  const screenshot = path.join(folder, `${name}.png`);
  const env = { ...process.env, DATA_DIR: state, SCREENSHOT: screenshot, SCREENSHOT_HASH: '#/', SCREENSHOT_DELAY: '500', SCREENSHOT_JS: script };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.resolve(executable), [], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const timer = setTimeout(() => child.kill(), 45_000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }).finally(() => clearTimeout(timer));
  if (code !== 0 || !fs.existsSync(`${screenshot}.json`)) throw new Error(`${name} failed: ${log.slice(-2000)}`);
  return JSON.parse(fs.readFileSync(`${screenshot}.json`, 'utf8'));
}
const before = await capture(previous, 'before', `(async()=>{
  const call=async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();};
  const termId=crypto.randomUUID(),presetId=crypto.randomUUID();
  await call('/api/settings','PUT',{keys:{grok:'upgrade-fake-key-6789'},proofread:{auto:false},cue:{maxLineChars:37},termLists:[{id:termId,name:'Upgrade terms',terms:'Cobblestone',glossary:'Redstone'}],presets:[{id:presetId,name:'Upgrade preset',context:'Synthetic series',provider:'grok',tracks:[{name:'Narrator',on:true}],termListIds:[termId]}],lastPresetId:presetId});
  const project=await call('/api/projects','POST',{name:'Upgrade compatibility check'});
  await call('/api/projects/'+project.id,'PATCH',{context:'This synthetic project must survive the upgrade.'});
  return {version:(await call('/api/version')).version,projectId:project.id,termId,presetId};
})()`);
const disk = JSON.parse(fs.readFileSync(path.join(state, 'settings.json'), 'utf8'));
if (!disk.keys.grok.startsWith('protected:v1:') || JSON.stringify(disk).includes('upgrade-fake-key')) throw new Error('Old app did not protect the fixture key.');
const after = await capture(current, 'after', `(async()=>{
  const expected=${JSON.stringify(before)};
  const settings=await (await fetch('/api/settings')).json();
  const project=await (await fetch('/api/projects/'+expected.projectId)).json();
  if(settings.keys?.grok!=='••••6789')throw new Error('Protected key did not survive');
  if(settings.cue?.maxLineChars!==37)throw new Error('Subtitle settings changed');
  if(!settings.termLists?.some(t=>t.id===expected.termId&&t.name==='Upgrade terms'))throw new Error('Term list missing');
  if(settings.lastPresetId!==expected.presetId||!settings.presets?.some(p=>p.id===expected.presetId&&p.tracks[0].name==='Narrator'))throw new Error('Preset missing');
  if(project.name!=='Upgrade compatibility check'||project.context!=='This synthetic project must survive the upgrade.')throw new Error('Project did not survive');
  return {version:(await (await fetch('/api/version')).json()).version,projects:'passed',settings:'passed',keyProtection:'passed'};
})()`);
if (after.version === before.version) throw new Error('The upgrade test needs two different app versions.');
console.log(`Upgrade ${before.version} -> ${after.version}: projects, settings, term lists, presets and protected keys passed.`);
console.log(`Upgrade smoke artifacts: ${folder}`);
