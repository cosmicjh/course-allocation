import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url),hash=data=>createHash('sha256').update(data).digest('hex');
const args=process.argv.slice(2),allowMissing=args.includes('--allow-missing');
if(args.some(arg=>arg!=='--allow-missing'))throw new Error('사용법: node scripts/timetable/vendor-check.mjs [--allow-missing]');
for(const name of ['timetable-model.js','timetable-cpsat.js','timetable-checker.js']){
  const original=await readFile(new URL(`shared/${name}`,root));
  let copy;
  try{copy=await readFile(new URL(`timetable-cloudflare/vendor/course-allocation/shared/${name}`,root));}
  catch(e){if(e.code==='ENOENT'){console.log(`${name}: vendor 사본 없음 — 통합시간표 저장소에서 동기화 후 확인하세요.`);if(!allowMissing)process.exitCode=1;continue;}throw e;}
  // The vendor convention permits a source-path comment before the exact source bytes.
  if(copy.subarray(0,2).toString()==='//'&&copy.toString().split('\n',1)[0].includes('course-allocation/shared/'))copy=copy.subarray(copy.indexOf(10)+1);
  const same=hash(original)===hash(copy);console.log(`${name}: ${same?'SHA-256 일치':'SHA-256 불일치'}`);if(!same)process.exitCode=1;
}
