import {createHarness} from '../tests/harness.mjs';
import {scaleState} from '../tests/fixtures/scale.js';
import * as S from '../shared/state.js';
import {digest} from '../server/crypto.js';
import {mkdir,writeFile} from 'node:fs/promises';

const iterations=Number(process.env.BENCHMARK_ITERATIONS||30);
if(!Number.isInteger(iterations)||iterations<5||iterations>100)throw new Error('반복 횟수는 5~100입니다.');
const h=await createHarness({seed:false}),state=scaleState();
const samples=[];
const time=async(action,fn)=>{const start=performance.now(),r=await fn();if(!r.ok)throw new Error(JSON.stringify(r));samples.push({action,ms:performance.now()-start,serverTiming:r.response.headers.get('server-timing'),rowsRead:Number(r.response.headers.get('x-d1-rows-read')),rowsWritten:Number(r.response.headers.get('x-d1-rows-written'))});return r;};
try{
  await h.db.prepare('DELETE FROM sheets').run();await h.db.prepare('UPDATE workspace SET payload=? WHERE id=1').bind(JSON.stringify(S.globalPart(state))).run();
  for(const d of state.departments){const part=S.departmentPart(state,d.id);await h.db.prepare('INSERT INTO sheets(id,payload,identity_hash) VALUES (?,?,?)').bind(d.id,JSON.stringify(part),await digest(S.identityKey(part))).run();}
  const token=(await time('login',()=>h.api('/access/login','POST',{code:'virtual-access-2026',includeState:true}))).data.accessToken;
  let latest=(await time('first-load',()=>h.api('/workspace?departmentId=d1','GET',undefined,token))).data;
  for(let i=0;i<iterations;i++){
    latest=(await time('load',()=>h.api('/workspace?departmentId=d1','GET',undefined,token))).data;
    const part=latest.parts[0];part.teachers[0].name='가상측정'+i;
    await time('save',()=>h.api('/sheets/d1','PUT',{part,revision:latest.revisions.d1,globalRevision:latest.globalRevision,operationId:'bench-'+crypto.randomUUID()},token));
  }
  const summary={};
  for(const action of new Set(samples.map(s=>s.action))){const rows=samples.filter(s=>s.action===action),values=rows.map(s=>s.ms).sort((a,b)=>a-b),round=v=>Math.round(v*100)/100;summary[action]={count:values.length,p50Ms:round(values[Math.ceil(values.length*.5)-1]),p95Ms:round(values[Math.ceil(values.length*.95)-1]),maxMs:round(values.at(-1)),averageRowsRead:round(rows.reduce((n,r)=>n+r.rowsRead,0)/rows.length),averageRowsWritten:round(rows.reduce((n,r)=>n+r.rowsWritten,0)/rows.length)};}
  const report={environment:'Local Miniflare/workerd D1; network emulation and production CPU enforcement excluded',fixture:{departments:state.departments.length,teachers:state.teachers.length,courses:state.courses.length,sections:state.groups.length,assignments:state.assignments.length},iterations,summary,samples};
  await mkdir('test-results',{recursive:true});await writeFile('test-results/benchmark.json',JSON.stringify(report,null,2)+'\n');console.table(summary);
}finally{await h.close();}
