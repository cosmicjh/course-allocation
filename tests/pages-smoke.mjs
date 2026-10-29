import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import '../scripts/build.mjs';
await mkdir('test-results',{recursive:true});
const persist='test-results/pages-d1-'+crypto.randomUUID();
const commands=[['pages','functions','build','functions','--outdir','test-results/pages-functions','--compatibility-date','2026-07-30'],
  ['d1','migrations','apply','allocation-test','--local','--persist-to',persist],
  ['d1','execute','allocation-test','--local','--persist-to',persist,'--file','tests/fixtures/demo.sql']];
const results=[];
for(const args of commands){
  const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  results.push({command:'wrangler '+args.join(' '),code,output});if(code!==0){console.error(output);throw new Error('Pages/D1 CLI 검증 실패');}console.log('PASS wrangler '+args.slice(0,3).join(' '));
}
await writeFile('test-results/pages-smoke.json',JSON.stringify(results,null,2)+'\n');
