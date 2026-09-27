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
const memory = await import('../server/memory.js');
memory.recordFix('couples stone','Cobblestone',{fixed:9});
memory.recordFix('couples stone','Cobblestone',{ignored:1});
memory.recordFix('red stone','Redstone',{fixed:2});
const createdAt = new Date().toISOString();
const project = {id:crypto.randomUUID(),name:'Minecraft · Episode 12',context:'Minecraft survival with two commentators.',presetId:null,createdAt};
store.saveProject(project);
store.saveSettings({proofread:{auto:false},termLists:[{id:crypto.randomUUID(),name:'Minecraft',terms:'Cobblestone, Redstone, Netherite',glossary:''}]});
const source = path.join(folder,'Episode 12.mkv');
const make = spawnSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=8','-f','lavfi','-i','sine=frequency=660:duration=8','-map','0:a','-map','1:a','-c:a','flac',source],{windowsHide:true});
if(make.status !== 0) throw new Error(String(make.stderr));
const media = {id:crypto.randomUUID(),projectId:project.id,name:path.basename(source),displayName:'Episode 12',sourcePath:source,sourceDir:folder,copied:false,status:'ready',duration:8,tracks:[0,1].map(index=>({index,channels:1,title:index?'Crainer mic':'SSundee mic',duration:8,extracted:true,timelineVersion:1})),createdAt};
store.saveMedia(media);
for (const track of media.tracks) await (await import('../server/ffmpeg.js')).extractTrack(source,track.index,jobs.trackAudioPath(media.id,track.index));
const job = jobs.createJob({projectId:project.id,provider:'grok',tracks:media.tracks.map(t=>({mediaId:media.id,index:t.index,label:t.title})),options:{voiceCleanup:false,language:'en'}});
job.status = 'done'; job.tracks.forEach(t=>Object.assign(t,{status:'done',wordCount:480,language:'en'})); store.saveJob(job);
const phrases = ['Let’s build the starter house over here.','We need a little more couples stone.','I’ll collect the wood while you finish the roof.','There’s red stone down in the cave.','Sunday, meet me back at the crafting table.'];
jobs.writeCues(job.id,Array.from({length:120},(_,i)=>({id:`${i%2}-${i}`,track:i%2,start:i*2,end:i*2+1.8,text:phrases[i%5],words:[],edited:false})));
jobs.writeSuggestions(job.id,[
  ...[1,6].map(i=>({id:`s-smoke-${i}`,cueId:`${i%2}-${i}`,from:'couples stone',to:'Cobblestone',source:'learned',tier:'usual',reason:'Fixed 9 of 10 times before',status:'open'})),
  {id:'s-smoke-name',cueId:'0-4',from:'Sunday',to:'SSundee',source:'people',tier:'unsure',reason:'Often misheard name',status:'open'},
  {id:'s-smoke-red',cueId:'1-3',from:'red stone',to:'Redstone',source:'learned',tier:'unsure',reason:'Fixed 2 of 2 times before',status:'open'},
]);
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
await capture('learned','#/learned');
await capture('subtitles','#/settings', "(async()=>{\n  const sleep=ms=>new Promise(r=>setTimeout(r,ms));\n  [...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()===\"Subtitle layout\").click(); await sleep(300);\n  \n  const count=()=>document.querySelectorAll('.preview-cues li').length;\n  const before=count(); if(!before) throw new Error('Preview shows no subtitles');\n  const input=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Max characters per line')).querySelector('input');\n  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'20'); input.dispatchEvent(new Event('input',{bubbles:true})); await sleep(200);\n  if(!(count()>before)) throw new Error('Preview did not re-split: '+before+' -> '+count());\n  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'42'); input.dispatchEvent(new Event('input',{bubbles:true})); await sleep(1500);\n  if(!document.querySelector('.frame-caption')) throw new Error('No caption on the preview frame');\n  document.querySelector('.preview-head').scrollIntoView({block:'start'}); window.scrollBy(0,-260);\n  return {preview:'passed',cues:[before,count()]};\n})()");
await capture('proofread','#/settings', "(async()=>{\n  const sleep=ms=>new Promise(r=>setTimeout(r,ms));\n  [...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()===\"Proofreading\").click(); await sleep(300);\n  \n  const sel=[...document.querySelectorAll('label')].find(l=>l.offsetParent!==null && l.textContent.startsWith('Model'))?.querySelector('select');\n  if(!sel) throw new Error('Model should be a dropdown');\n  if(!sel.options[0].textContent.includes('gpt-6-luna') && !sel.options[0].textContent.includes('Default')) throw new Error('Unexpected default option: '+sel.options[0].textContent);\n  return {models:[...sel.options].map(o=>o.textContent)};\n})()");
await capture('terms','#/settings', "(async()=>{\n  const sleep=ms=>new Promise(r=>setTimeout(r,ms));\n  [...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()==='Term lists').click(); await sleep(200);\n  if(document.querySelector('.term-list .list-name')) throw new Error('Term lists should start collapsed');\n  const toggle=document.querySelector('.term-list .list-toggle'); toggle.click(); await sleep(100);\n  if(!document.querySelector('.term-list.open textarea')) throw new Error('Expanding a list shows its terms');\n  toggle.click(); await sleep(100);\n  const input=[...document.querySelectorAll('input[type=file]')].find(i=>i.accept.includes('json') && i.closest('.card')?.textContent.includes('Term lists'));\n  const dt=new DataTransfer(); dt.items.add(new File([JSON.stringify({kind:'grok-transcriber-term-list',version:1,name:'ATM10 To The Sky',terms:'Allthemodium, Vibranium',glossary:'Allthemodium Ingot\\nVibranium Ore'})],'ATM10.json',{type:'application/json'}));\n  input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); await sleep(300);\n  const names=[...document.querySelectorAll('.term-list .list-name')].map(i=>i.value);\n  if(names.join()!=='ATM10 To The Sky') throw new Error('Imported list opens expanded: '+names.join());\n  if(!document.querySelector('.term-list.closed .list-summary')?.textContent.includes('3 priority')) throw new Error('Collapsed summary shows counts');\n  window.scrollTo(0,0); document.querySelector('.term-list').scrollIntoView({block:'start'});\n  return {termLists:'passed'};\n})()");
await capture('aiterms','#/settings', "(async()=>{\n  const sleep=ms=>new Promise(r=>setTimeout(r,ms));\n  const set=(el,v)=>{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};\n  const btn=(root,name)=>[...root.querySelectorAll('button')].find(b=>b.offsetParent!==null&&b.textContent.trim()===name);\n  [...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()==='Term lists').click(); await sleep(300);\n  const open=async()=>{btn(document,'Build with AI').click(); await sleep(250); return document.querySelector('dialog.ai-dialog[open]');};\n  let dlg=await open(); if(!dlg) throw new Error('Build with AI did not open');\n  set(dlg.querySelector('input'),'Terraria'); await sleep(80);\n  if(!dlg.querySelector('.ai-prompt').value.includes('words from Terraria correctly')) throw new Error('Prompt does not name the game');\n  set(dlg.querySelector('textarea:not(.ai-prompt)'),'Sure! ```json\\n{\"kind\":\"grok-transcriber-term-list\",\"version\":1,\"name\":\"Terraria\",\"terms\":[\"Moon Lord\",\"Terraprisma\"],\"glossary\":[\"Zenith\",\"Eye of Cthulhu\"]}\\n```'); await sleep(80);\n  btn(dlg,'Create list').click(); await sleep(300);\n  if(document.querySelector('dialog.ai-dialog[open]')) throw new Error('Dialog stayed open: '+(document.querySelector('.ai-dialog .error')?.textContent||''));\n  const names=[...document.querySelectorAll('.term-list .list-name')].map(i=>i.value);\n  if(!names.includes('Terraria')) throw new Error('List not created: '+names.join());\n  dlg=await open(); set(dlg.querySelector('input'),'ATM10 To The Sky'); set(dlg.querySelectorAll('input')[1],'Minecraft 1.21 modpack'); await sleep(150);\n  return {aiTermList:'passed'};\n})()");
await capture('intro','#/', "(async()=>{ const sleep=ms=>new Promise(r=>setTimeout(r,ms));\n  const until=async fn=>{for(let n=0;n<200;n++){if(await fn())return;await sleep(50);}throw new Error('Timed out');};\n  window.dispatchEvent(new KeyboardEvent('keydown',{key:'T',ctrlKey:true,shiftKey:true})); await sleep(300);\n  const dlg=document.querySelector('dialog.team-dialog[open]'); if(!dlg) throw new Error('Ctrl+Shift+T did not open team setup');\n  await until(()=>dlg.querySelector('.granted'));\n  if(dlg.querySelectorAll('.terminal > div').length<7) throw new Error('Intro lines missing');\n  await sleep(700);\n  return {intro:'passed'};\n})()");
await capture('team','#/', "(async()=>{ const sleep=ms=>new Promise(r=>setTimeout(r,ms));\n  const until=async fn=>{for(let n=0;n<200;n++){if(await fn())return;await sleep(50);}throw new Error('Timed out');};\n  window.dispatchEvent(new KeyboardEvent('keydown',{key:'T',ctrlKey:true,shiftKey:true})); await sleep(300);\n  const dlg=document.querySelector('dialog.team-dialog[open]'); if(!dlg) throw new Error('Ctrl+Shift+T did not open team setup');\n  const skip=[...dlg.querySelectorAll('button')].find(b=>['Skip','Let me in'].includes(b.textContent.trim())); if(!skip) throw new Error('Intro should show until it is seen'); skip.click(); await sleep(150);\n  if(!dlg.textContent.includes(\"Welcome to Nico's SUPER SECRET SETUP!!!\")) throw new Error('Missing welcome title');\n  const settingsFile=await (await fetch('/api/team-setup/settings-export')).text();\n  const dt=new DataTransfer();\n  dt.items.add(new File([['XAI_API_KEY=xai-smoke-4242','OPENAI_API_KEY=sk-smoke-1111'].join(String.fromCharCode(10))],'team.env'));\n  dt.items.add(new File([settingsFile],'Grok Transcriber settings.json'));\n  const input=dlg.querySelector('input[type=file]'); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));\n  await until(()=>dlg.querySelector('.team-result')?.textContent.includes('Settings imported'));\n  const text=dlg.querySelector('.team-result').textContent;\n  if(!text.includes('Grok (xAI), OpenAI')) throw new Error('Keys not reported: '+text);\n  if(!dlg.querySelector('.confetti span')) throw new Error('No confetti');\n  const keys=(await (await fetch('/api/settings')).json()).keys; if(keys.grok!=='••••4242'||keys.openai!=='••••1111') throw new Error('Keys not saved');\n  await sleep(250);\n  return {teamSetup:'passed'};\n})()");
await capture('export',`#/jobs/${job.id}`, `(async()=>{ [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save next to the videos').click(); await new Promise(r=>setTimeout(r,400)); if(!document.querySelector('dialog[open]'))throw new Error('No export dialog'); return {preview:'passed'}; })()`);
console.log(`Desktop smoke artifacts: ${folder}`);
