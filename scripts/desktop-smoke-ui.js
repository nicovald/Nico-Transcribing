(async () => {
  const fixture = __FIXTURE__;
  const checks = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
  const until = async fn => { for(let n=0;n<100;n++){ if(await fn()) return; await sleep(50); } throw new Error('Timed out waiting for UI'); };
  const button = name => [...document.querySelectorAll('button')].find(b=>b.offsetParent!==null && b.textContent.trim()===name);
  const input = (el,value) => { const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); };
  const get = async url => (await fetch(url)).json();
  const route = async hash => { location.hash=hash; await sleep(350); };

  const post = async (url,body) => { const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const value=await res.json(); if(!res.ok)throw new Error(value.error); return value; };
  const importedProject=await post('/api/projects',{name:'Packaged media check'});
  await post(`/api/projects/${importedProject.id}/media`,{paths:[fixture.source]});
  await until(async()=>{const p=await get(`/api/projects/${importedProject.id}`);if(p.media[0]?.status==='error')throw new Error(p.media[0].error);return p.media[0]?.status==='ready';});
  assert((await get(`/api/projects/${importedProject.id}`)).media[0].tracks.length===2,'Bundled ffprobe and ffmpeg import both audio tracks');
  await fetch(`/api/projects/${importedProject.id}`,{method:'DELETE'});

  await until(()=>document.querySelector('input[aria-label="Grok (xAI) API key"]'));
  input(document.querySelector('input[aria-label="Grok (xAI) API key"]'),'desktop-test-fake-key');
  await until(()=>!button('Save settings').disabled);
  button('Save settings').click();
  await until(()=>button('Save settings')?.disabled);
  assert((await get('/api/settings')).keys.grok.startsWith('••••'),'Settings saved and API key masked');

  await route(`#/projects/${fixture.projectId}`);
  await until(()=>document.querySelector('input[aria-label="Track 1 name"]'));
  input(document.querySelector('input[aria-label="Track 1 name"]'),'Sundee commentary');
  await until(async()=>Object.values((await get(`/api/projects/${fixture.projectId}`)).setup?.tracks||{}).some(t=>t.label==='Sundee commentary'));
  await route('#/'); await route(`#/projects/${fixture.projectId}`);
  assert(document.querySelector('input[aria-label="Track 1 name"]').value==='Sundee commentary','Track setup survives navigation');

  await route(`#/jobs/${fixture.jobId}`);
  await until(()=>document.querySelector('.cue-text'));
  assert(document.querySelectorAll('.cue').length===100,'Long transcripts render one page at a time');
  button('Next page').click(); await sleep(100);
  assert(document.querySelectorAll('.cue').length===20,'Transcript pagination reaches remaining lines');
  button('Previous page').click(); await sleep(100);
  const first = document.querySelector('.cue-text'); const original = first.textContent;
  first.click(); await sleep(50);
  input(document.querySelector('.cue-edit'),original+' Edited for test.');
  await sleep(50);
  assert(document.querySelector('input[aria-label="Search transcript"]').disabled && button('Review').disabled,'Review filters cannot hide an unsaved line edit');
  const nativeFetch=window.fetch;
  window.fetch=(url,init)=>init?.method==='PATCH'&&String(url).includes('/cues/')?Promise.resolve(new Response(JSON.stringify({error:'Simulated save failure'}),{status:503,headers:{'Content-Type':'application/json'}})):nativeFetch(url,init);
  await sleep(50);button('Save line').click();
  await until(()=>document.body.textContent.includes('Simulated save failure'));
  assert(document.querySelector('.cue-edit')?.value.endsWith('Edited for test.'),'A failed save keeps the editor and typed text');
  window.fetch=nativeFetch;button('Save line').click();
  await until(()=>!document.querySelector('.cue-edit'));
  assert((await get(`/api/jobs/${fixture.jobId}`)).cues[0].text.endsWith('Edited for test.'),'Editing persists after retry');
  button('Undo').click();await until(async()=>(await get(`/api/jobs/${fixture.jobId}`)).cues[0].text===original);
  assert(true,'Undo restores the original line');
  await until(()=>button('Fix all 2'));
  button('Fix all 2').click();await until(async()=>(await get(`/api/jobs/${fixture.jobId}`)).suggestions.every(s=>s.status!=='open'));
  const edited = (await get(`/api/jobs/${fixture.jobId}`)).cues.filter(c=>c.text.includes('Cobblestone'));
  assert(edited.length===2,'Fix all changes exactly the displayed count');
  button('Undo').click();await sleep(100);
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true}));await sleep(100);
  assert(document.activeElement?.classList.contains('tc'),'J focuses the next issue for keyboard playback');
  button('Save next to the videos').click();await until(()=>document.querySelector('dialog[open]'));
  assert(document.querySelectorAll('.export-file').length===3,'Export previews all single-track and merged files');
  button('Export files').click();await until(()=>!document.querySelector('dialog[open]'));
  assert(document.querySelector('.saved')?.textContent.includes('Saved 3 files'),'Export saves the selected subtitles');
  window.scrollTo(0,0);
  return {passed:checks.length,checks};
})()
