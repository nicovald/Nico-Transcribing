import fs from 'node:fs';
import path from 'node:path';
export const safeName = value => {
  let name = String(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,'').replace(/[. ]+$/g,'').trim().slice(0,140) || 'subtitles';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name;
};
export function uniqueFiles(files) {
  const seen = new Set();
  return files.map(file => {
    const stem = path.basename(file.filename,'.srt').slice(0,180).replace(/[. ]+$/g,'');
    let filename = `${stem}.srt`, n = 2;
    while (seen.has(filename.toLowerCase())) filename = `${stem} (${n++}).srt`;
    seen.add(filename.toLowerCase());
    return { ...file, filename };
  });
}
export function exportPlan(files, { dir, keys } = {}, sourceDir) {
  if (keys != null && (!Array.isArray(keys) || keys.some(k => typeof k !== 'string'))) throw new Error('Choose subtitle files from the export list.');
  if (dir != null && (typeof dir !== 'string' || !path.isAbsolute(dir))) throw new Error('Choose an absolute destination folder.');
  return files.filter(f => !keys || keys.includes(f.key)).map(f => {
    const folder = dir || sourceDir(f.mediaId);
    if (!folder) throw new Error('Choose a folder to save these subtitles.');
    if (!fs.statSync(folder).isDirectory()) throw new Error('The destination is not a folder.');
    const destination = path.join(folder,f.filename);
    return { ...f, destination, exists: fs.existsSync(destination) };
  });
}
export function writeExports(plan, conflict) {
  if (!plan.length) throw new Error('Select at least one subtitle file.');
  if (!['replace','keep-both',undefined].includes(conflict)) throw new Error('Choose how to handle existing files.');
  if (!conflict && plan.some(f => f.exists)) throw Object.assign(new Error('Some subtitle files already exist. Choose Keep both or Replace.'), { status: 409, conflicts: plan.filter(f=>f.exists).map(f=>f.destination) });
  const written = [];
  try {
    for (const file of plan) {
      let dest = file.destination;
      if (conflict === 'keep-both') {
        const ext = path.extname(dest), stem = dest.slice(0,-ext.length);
        let n = 2;
        while (fs.existsSync(dest) || written.some(p => p.toLowerCase() === dest.toLowerCase())) dest = `${stem} (${n++})${ext}`;
      }
      if (conflict === 'replace') {
        const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
        try { fs.writeFileSync(tmp,`\uFEFF${file.content}`); fs.renameSync(tmp,dest); }
        finally { fs.rmSync(tmp,{force:true}); }
      } else fs.writeFileSync(dest,`\uFEFF${file.content}`,{flag:'wx'});
      written.push(dest);
    }
  } catch (err) { throw Object.assign(new Error(`Saved ${written.length} file(s), then stopped: ${err.message}`), { written }); }
  return written;
}
