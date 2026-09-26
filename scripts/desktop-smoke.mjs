// A real Electron interaction check using synthetic media, fake keys and isolated data.
// Run `npm run build` first. No transcription provider is called.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root,'data','desktop-smoke',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
process.env.DATA_DIR = path.join(folder,'state');
const store = await import('../server/store.js');
const jobs = await import('../server/jobs.js');
const createdAt = new Date().toISOString();
const project = {id:crypto.randomUUID(),name:'Minecraft · Episode 12',context:'Minecraft survival with two commentators.',presetId:null,createdAt};
store.saveProject(project);
store.saveSettings({proofread:{auto:false},termLists:[{id:crypto.randomUUID(),name:'Minecraft',terms:'Cobblestone, Redstone, Netherite',glossary:''}]});
const source = path.join(folder,'Episode 12.mkv');
const make = spawnSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=8','-f','lavfi','-i','sine=frequency=660:duration=8','-map','0:a','-map','1:a','-c:a','flac',source],{windowsHide:true});
if(make.status !== 0) throw new Error(String(make.stderr));
const media = {id:crypto.randomUUID(),projectId:project.id,name:path.basename(source),displayName:'Episode 12',sourcePath:source,sourceDir:folder,copied:false,status:'ready',duration:8,tracks:[0,1].map(index=>({index,channels:1,title:index?'Crainer mic':'Sundee mic',duration:8,extracted:true,timelineVersion:1})),createdAt};
store.saveMedia(media);
for (const track of media.tracks) await (await import('../server/ffmpeg.js')).extractTrack(source,track.index,jobs.trackAudioPath(media.id,track.index));
const job = jobs.createJob({projectId:project.id,provider:'grok',tracks:media.tracks.map(t=>({mediaId:media.id,index:t.index,label:t.title})),options:{voiceCleanup:false,language:'en'}});
job.status = 'done'; job.tracks.forEach(t=>Object.assign(t,{status:'done',wordCount:480,language:'en'})); store.saveJob(job);
const phrases = ['Let’s build the starter house over here.','We need a little more couples stone.','I’ll collect the wood while you finish the roof.','There’s red stone down in the cave.','Meet me back at the crafting table.'];
jobs.writeCues(job.id,Array.from({length:120},(_,i)=>({id:`${i%2}-${i}`,track:i%2,start:i*2,end:i*2+1.8,text:phrases[i%5],words:[],edited:false})));
jobs.writeSuggestions(job.id,[1,6].map(i=>({id:`s-smoke-${i}`,cueId:`${i%2}-${i}`,from:'couples stone',to:'Cobblestone',source:'glossary',status:'open'})));
const fixture = {projectId:project.id,jobId:job.id,source};
const executable = process.argv[2] || path.join(root,'node_modules/electron/dist/electron.exe');
async function capture(name,hash,script) {
  const env = {...process.env,SCREENSHOT:path.join(folder,`${name}.png`),SCREENSHOT_HASH:hash,SCREENSHOT_DELAY:'800',SCREENSHOT_WIDTH:'1280'};
  if(script) env.SCREENSHOT_JS = script; else delete env.SCREENSHOT_JS;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable,process.argv[2]?[]:['.'],{cwd:root,windowsHide:true,env,stdio:['ignore','pipe','pipe']});
  let log=''; child.stdout.on('data',d=>{log+=d;});child.stderr.on('data',d=>{log+=d;});
  const timeout = setTimeout(() => child.kill(), 45000);
  const code = await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  clearTimeout(timeout);
  if(code) throw new Error(`${name} failed: ${log.slice(-3000)}`);
  if(!fs.existsSync(env.SCREENSHOT)) throw new Error(`${name} produced no screenshot: ${log}`);
  console.log(`${name}: passed`);
}
const script = fs.readFileSync(path.join(root,'scripts/desktop-smoke-ui.js'),'utf8').replace('__FIXTURE__',JSON.stringify(fixture));
await capture('review', '#/settings', script);
const disk = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR,'settings.json'),'utf8'));
if(!disk.keys.grok.startsWith('protected:v1:') || JSON.stringify(disk).includes('desktop-test-fake-key')) throw new Error('Key was not protected on disk');
await capture('settings','#/settings', `(async()=>{ const s=await (await fetch('/api/settings')).json(); if(!s.keys.grok.startsWith('••••'))throw new Error('Protected key did not reopen'); return {keyProtection:'passed'}; })()`);
await capture('project',`#/projects/${project.id}`);
await capture('home','#/');
await capture('export',`#/jobs/${job.id}`, `(async()=>{ [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save next to the videos').click(); await new Promise(r=>setTimeout(r,400)); if(!document.querySelector('dialog[open]'))throw new Error('No export dialog'); return {preview:'passed'}; })()`);
console.log(`Desktop smoke artifacts: ${folder}`);
