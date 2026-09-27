import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import ffmpeg from 'ffmpeg-static';

const temp = fs.mkdtempSync(path.join(os.tmpdir(),'transcriber-test-'));
process.env.DATA_DIR = path.join(temp,'data');
const store = await import('./store.js');
const jobs = await import('./jobs.js');
const sug = await import('./suggestions.js');
const history = await import('./history.js');
const { app, configureDesktop } = await import('./index.js');
const { providers } = await import('./providers/index.js');
const { proofreaders } = await import('./proofreaders.js');
const { probe, extractTrack } = await import('./ffmpeg.js');
const { readTranscript, updateTranscript } = await import('./transcript.js');
const server = app.listen(0,'127.0.0.1');
await once(server,'listening');
after(async () => { server.closeAllConnections(); await new Promise(r=>server.close(r)); if (temp.startsWith(path.join(os.tmpdir(),'transcriber-test-'))) fs.rmSync(temp,{recursive:true,force:true}); });
const call = async (route,method='GET',body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  return { status:res.status, body:await res.json() };
};
const project = {id:crypto.randomUUID(),name:'Test project',context:'Minecraft',createdAt:new Date().toISOString()};
store.saveProject(project);
store.saveSettings({keys:{grok:'test-only'},proofread:{auto:false}});
const media = {id:crypto.randomUUID(),projectId:project.id,name:'fixture.wav',displayName:'Fixture',sourceDir:temp,status:'ready',duration:1,tracks:[{index:0,extracted:true,duration:1},{index:1,extracted:true,duration:1}],createdAt:project.createdAt};
store.saveMedia(media);
const words = [{text:'couples',start:0,end:.3,confidence:.8},{text:'stone',start:.3,end:.6,confidence:.8}];
const createJob = () => jobs.createJob({projectId:project.id,provider:'grok',tracks:[0,1].map(index=>({mediaId:media.id,index,label:'Mic'})),options:{voiceCleanup:false}});
const cue = (id,text='couples stone') => ({id,track:0,start:0,end:1,text,words,edited:false});
const seed = () => {
  const job = createJob(); job.status='done'; job.tracks.forEach(t=>t.status='done');store.saveJob(job);
  jobs.writeCues(job.id,[cue('0-0'),cue('0-1'),cue('0-2')]);
  jobs.writeSuggestions(job.id,[0,1].map(i=>({id:`s-${i}`,cueId:`0-${i}`,from:'couples stone',to:'Cobblestone',source:'ai',status:'open'})));
  return job;
};

test('collection traversal cannot remove a sibling directory',async()=>{
  const sentinel=path.join(store.DATA_DIR,'sentinel');fs.mkdirSync(sentinel);fs.writeFileSync(path.join(sentinel,'keep'),'keep');
  assert.equal((await call('/api/media/'+encodeURIComponent('../sentinel'),'DELETE')).status,400);
  assert.ok(fs.existsSync(path.join(sentinel,'keep')));
  assert.throws(()=>store.jobDir('../outside'),/Invalid/);
});
test('malformed multipart returns 400 and server remains available',async()=>{
  const res=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${project.id}/upload`,{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=audit'},body:'--audit\r\nContent-Disposition: form-data; name="file"; filename="bad.wav"\r\n\r\ntruncated'});
  assert.equal(res.status,400);assert.equal((await call('/api/version')).status,200);
  assert.ok(!fs.readdirSync(store.MEDIA_DIR).some(f=>f.startsWith('upload-')));
});
test('bulk fixes affect matching flagged lines only and undo preserves newer checks',()=>{
  const job=seed(); const fixed=sug.acceptSuggestion(job.id,'s-0',{all:true,to:'$& Cobblestone'});
  assert.equal(fixed.cues.length,2); assert.equal(jobs.readCues(job.id)[2].text,'couples stone');
  assert.equal(fixed.cues[0].text,'$& Cobblestone');
  updateTranscript(job.id,s=>s.suggestions.push({id:'new-check',cueId:'0-2',from:'couples stone',to:'Something else',source:'compare',status:'open'}));
  history.undo(job.id);
  assert.ok(jobs.readCues(job.id).every(c=>c.text==='couples stone'));
  assert.ok(jobs.readSuggestions(job.id).some(s=>s.id==='new-check'));
});
test('stale proofreading is dropped and zero-term glossary clears open flags',async()=>{
  const job=seed();store.saveSettings({keys:{anthropic:'test-only'}});
  let release; proofreaders.claude.run=()=>new Promise(r=>{release=r;});
  const task=sug.startProofread(job.id);await new Promise(r=>setImmediate(r));
  await call(`/api/jobs/${job.id}/cues/0-0`,'PATCH',{text:'Already fixed'});
  release({fixes:[{id:'0-0',from:'couples stone',to:'Cobblestone',reason:'term'}]});await task;
  assert.ok(!jobs.readSuggestions(job.id).some(s=>s.cueId==='0-0'&&s.status==='open'));
  jobs.writeSuggestions(job.id,[{id:'g',cueId:'0-1',from:'couples stone',to:'Cobblestone',source:'glossary',status:'open'}]);
  await sug.runGlossaryCheck(job.id);assert.equal(jobs.readSuggestions(job.id).length,0);
  store.saveSettings({keys:{anthropic:''}});
});
test('invalid cue times, settings and cross-project tracks are rejected',async()=>{
  const job=seed();assert.equal((await call(`/api/jobs/${job.id}/cues/0-0`,'PATCH',{start:10,end:2})).status,400);
  assert.equal((await call('/api/settings','PUT',{termLists:null})).status,400);
  const other={...project,id:crypto.randomUUID()};store.saveProject(other);
  assert.throws(()=>jobs.createJob({projectId:other.id,provider:'grok',tracks:[{mediaId:media.id,index:0}]}),/this project/);
  assert.throws(()=>jobs.createJob({projectId:project.id,provider:'grok',tracks:[{mediaId:media.id,index:99}]}),/available track/);
});
test('export names are unique and existing files need an explicit choice',async()=>{
  const job=seed();const folder=path.join(temp,'exports');fs.mkdirSync(folder);
  const first=await call(`/api/jobs/${job.id}/export`,'POST',{dir:folder});assert.equal(first.status,200);assert.equal(new Set(first.body.written).size,3);
  assert.equal((await call(`/api/jobs/${job.id}/export`,'POST',{dir:folder})).status,409);
  const second=await call(`/api/jobs/${job.id}/export`,'POST',{dir:folder,conflict:'keep-both'});assert.equal(second.status,200);assert.equal(fs.readdirSync(folder).length,6);
});
test('atomic transcript storage recovers corruption from last good backup',()=>{
  const job=seed();const target=path.join(store.jobDir(job.id),'transcript.json');
  jobs.writeCues(job.id,[cue('0-0','new version')]);fs.writeFileSync(target,'broken');
  assert.equal(readTranscript(job.id).cues[0].text,'couples stone');
  assert.ok(fs.readdirSync(store.jobDir(job.id)).some(f=>f.includes('.damaged-')));
});
test('real audio extraction preserves a two-second stream offset',async()=>{
  const source=path.join(temp,'offset.mkv'),output=path.join(temp,'offset.flac');
  const r=spawnSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=black:s=64x64:r=10:d=5','-itsoffset','2','-f','lavfi','-i','sine=frequency=440:duration=2','-map','0:v','-map','1:a','-c:v','mpeg4','-c:a','pcm_s16le',source],{windowsHide:true});
  assert.equal(r.status,0,String(r.stderr));const info=await probe(source);assert.equal(info.tracks[0].startOffset,2);
  await extractTrack(source,0,output,{startOffset:info.tracks[0].startOffset});
  assert.ok(Math.abs((await probe(output)).duration-4)<.05);
  const silence=spawnSync(ffmpeg,['-v','info','-i',output,'-af','silencedetect=noise=-50dB:d=1','-f','null','-'],{windowsHide:true,encoding:'utf8'});
  assert.match(silence.stderr,/silence_end: 2/);
  fs.copyFileSync(output,jobs.trackAudioPath(media.id,0));fs.copyFileSync(output,jobs.trackAudioPath(media.id,1));
});
test('deleting a running job waits for cancellation and never recreates it',async()=>{
  const job=createJob();let entered;const started=new Promise(r=>{entered=r;});
  providers.grok.transcribe=({signal})=>new Promise((resolve,reject)=>{entered();if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  const task=jobs.runJob(job.id);await started;
  assert.equal((await call(`/api/jobs/${job.id}`,'DELETE')).status,200);await task;assert.equal(store.getJob(job.id),null);
});
test('partial job completion is not reported as done and retry keeps successful tracks',async()=>{
  const job=createJob();let calls=0;providers.grok.transcribe=async()=>{if(++calls===2)throw new Error('Temporary provider error');return{words,language:'en'};};
  await jobs.runJob(job.id);assert.equal(store.getJob(job.id).status,'partial');
  providers.grok.transcribe=async()=>{calls++;return{words,language:'en'};};await jobs.runJob(job.id,{onlyFailed:true});
  assert.equal(store.getJob(job.id).status,'done');assert.equal(calls,3);
});

test('project setup persists and preset edits do not alter existing projects', async () => {
  const preset = { id: crypto.randomUUID(), name: 'Series', context: 'Original', provider: 'grok', tracks: [{name:'Original mic',on:true}] };
  await call('/api/settings','PUT',{presets:[preset]});
  const created = (await call('/api/projects','POST',{name:'Saved setup',presetId:preset.id})).body;
  const setup = {provider:'grok',options:{language:'fr',voiceCleanup:false},tracks:{[`${media.id}:0`]:{on:false,label:'Editor mic'}}};
  assert.equal((await call(`/api/projects/${created.id}`,'PATCH',{setup})).status,200);
  await call('/api/settings','PUT',{presets:[{...preset,context:'Changed',tracks:[{name:'Changed mic',on:true}]}]});
  const reloaded = (await call(`/api/projects/${created.id}`)).body;
  assert.deepEqual(reloaded.setup,setup);
  assert.equal(reloaded.presetSnapshot.tracks[0].name,'Original mic');
});

test('the desktop API requires its session and rejects cross-site requests', async () => {
  configureDesktop('test-session');
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/version`;
    assert.equal((await fetch(url)).status,403);
    assert.equal((await fetch(url,{headers:{cookie:'desktop-session=test-session'}})).status,200);
    assert.equal((await fetch(url,{headers:{cookie:'desktop-session=test-session','Sec-Fetch-Site':'cross-site'}})).status,403);
  } finally { configureDesktop(null); }
});

test('global transcription slots cap work across jobs and queued work cancels', async () => {
  const { withTrackSlot } = await import('./work.js');
  const controller = new AbortController();
  let active = 0, peak = 0;
  const tasks = Array.from({length:9},() => withTrackSlot(controller.signal,async () => {
    peak = Math.max(peak,++active);
    await new Promise(resolve => setTimeout(resolve,5));
    active--;
  }));
  const cancelled = new AbortController();
  const waiting = withTrackSlot(cancelled.signal, () => assert.fail('Cancelled work ran'));
  cancelled.abort(new Error('test cancellation'));
  await assert.rejects(waiting,/test cancellation/);
  await Promise.all(tasks);
  assert.equal(peak,4);
});

test('retry reuses completed chunks from a failed track', async () => {
  const originalChunk = providers.grok.chunkSeconds;
  const savedMedia = store.getMedia(media.id);
  store.saveMedia({...savedMedia,tracks:savedMedia.tracks.map(t=>({...t,duration:4}))});
  providers.grok.chunkSeconds = 2;
  try {
    const job = jobs.createJob({projectId:project.id,provider:'grok',tracks:[{mediaId:media.id,index:0}],options:{voiceCleanup:false}});
    let calls = 0;
    providers.grok.transcribe = async () => { if (++calls === 2) throw new Error('temporary failure'); return {words,language:'en'}; };
    await jobs.runJob(job.id);
    assert.equal(store.getJob(job.id).status,'error');
    await jobs.runJob(job.id,{onlyFailed:true});
    assert.equal(store.getJob(job.id).status,'done');
    assert.equal(calls,3);
    assert.ok(jobs.readWords(job.id,0).some(w=>w.start>=2));
  } finally { providers.grok.chunkSeconds = originalChunk; store.saveMedia(savedMedia); }
});

test('desktop key migration protects both settings and its backup', () => {
  const settingsFile = path.join(store.DATA_DIR,'settings.json');
  const key = 'fake-secret-for-storage-test';
  store.saveSettings({keys:{grok:key}});
  // Fake codec exercises storage/migration; the Electron smoke test uses Windows DPAPI.
  store.configureSecrets({encrypt:value=>Buffer.from(value).toString('base64'),decrypt:value=>Buffer.from(value,'base64').toString()});
  assert.equal(store.getSettings().keys.grok,key);
  assert.ok(JSON.parse(fs.readFileSync(settingsFile,'utf8')).keys.grok.startsWith('protected:v1:'));
  assert.ok(!fs.readFileSync(settingsFile,'utf8').includes(key));
  assert.ok(!fs.readFileSync(`${settingsFile}.bak`,'utf8').includes(key));
  store.saveSettings({keys:{grok:'another-fake-key'}});
  assert.equal(store.getSettings().keys.grok,'another-fake-key');
});
test('Fix, Ignore and hand edits teach the learned list, and the next check uses it',async()=>{
  const job=seed(), learned=()=>call('/api/memory').then(r=>r.body.fixes);
  await call(`/api/jobs/${job.id}/suggestions/s-0/accept`,'POST',{});
  const fix=(await learned()).find(f=>f.from==='couples stone'&&f.to==='Cobblestone');
  assert.ok(fix.fixed>=1);
  await call(`/api/jobs/${job.id}/suggestions/s-1/dismiss`,'POST',{});
  assert.equal((await learned()).find(f=>f.id===fix.id).ignored,fix.ignored+1);
  jobs.writeCues(job.id,[cue('0-0','hey Crainer grab the ender perl')]);
  await call(`/api/jobs/${job.id}/cues/0-0`,'PATCH',{text:'hey Crainer grab the Ender Pearl'});
  assert.equal((await learned()).find(f=>f.from==='ender perl')?.to,'Ender Pearl');
  const next=seed();jobs.writeCues(next.id,[cue('0-0','one more ender perl'),cue('0-1','Craner come here')]);
  await sug.runMemoryCheck(next.id);
  const open=jobs.readSuggestions(next.id).filter(s=>s.status==='open'&&['learned','people'].includes(s.source)).map(s=>`${s.from}>${s.to}>${s.tier}`).sort();
  assert.deepEqual(open,['Craner>Crainer>unsure','ender perl>Ender Pearl>unsure']);
  const exported=await fetch(`http://127.0.0.1:${server.address().port}/api/memory/export`);
  assert.match(exported.headers.get('content-disposition'),/attachment/);
  assert.equal((await call('/api/memory/import','POST',await exported.json())).body.fixes,0);
});
test('team setup file saves keys without ever sending them back',async()=>{
  const r=await call('/api/team-setup','POST',{text:'XAI_API_KEY=xai-team-secret-9876\r\nOTHER=1'});
  assert.equal(r.status,200);
  assert.deepEqual(r.body,{services:['Grok (xAI)'],ignored:['OTHER']});
  assert.equal(store.getSettings().keys.grok,'xai-team-secret-9876');
  const shown=(await call('/api/settings')).body.keys.grok;
  assert.equal(shown,'••••9876');
  const empty=await call('/api/team-setup','POST',{text:'HELLO=1'});
  assert.equal(empty.status,400); assert.match(empty.body.error,/No API keys/);
  store.saveSettings({keys:{grok:'test-only'}});
});
