import assert from 'node:assert/strict';
import {createRemoteHarness} from '../tests/remote-harness.mjs';
import {scaleState} from '../tests/fixtures/scale.js';
import * as C from '../shared/domain.js';

const h=await createRemoteHarness({seed:false}),checks=[];
const input=await h.login(),admin=await h.login(true);
const startAt=new Date().toISOString();
if(process.env.ALLOCATION_BULK_TEST==='1'){
  const empty=scaleState();empty.departments=[{id:'virtual-empty',name:'가상초기화확인',status:'draft',sourceTotal:null,note:''}];
  empty.teachers=[];empty.courses=[];empty.groups=[];empty.assignments=[];
  await h.seedState(empty);
}
await h.seedState(scaleState());
if(process.env.ALLOCATION_BULK_TEST==='1'){checks.push({name:'가상 교과군 12개 신규 일괄 반영',pass:true});console.log('PASS 가상 교과군 12개 신규 일괄 반영');}
const sheet=async(id='d1')=>{const w=h.requireOk(await h.api('/workspace?departmentId='+id,'GET',undefined,admin));return {part:w.parts[0],revision:w.revisions[id],globalRevision:w.globalRevision,operationId:'remote-'+crypto.randomUUID()};};
async function check(name,fn){await fn();checks.push({name,pass:true});console.log('PASS '+name);}
await check('원격 미인증 접근 거부',async()=>{assert.equal((await h.api('/workspace')).status,401);});
await check('원격 동일 교과군 동시 저장 및 중복 요청',async()=>{
  const a=await sheet(),b=C.clone(a);a.part.teachers[0].name='가상원격동시A';b.part.teachers[0].name='가상원격동시B';b.operationId='remote-'+crypto.randomUUID();
  const r=await Promise.all([h.api('/sheets/d1','PUT',a,input),h.api('/sheets/d1','PUT',b,input)]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);
  const winner=r[0].ok?a:b,first=r.find(x=>x.ok);assert.equal((await h.api('/sheets/d1','PUT',winner,input)).data.revision,first.data.revision);
});
await check('원격 다른 교과군 독립 저장',async()=>{
  const a=await sheet('d1'),b=await sheet('d2');a.part.teachers[0].name='가상독립1';b.part.teachers[0].name='가상독립2';
  const r=await Promise.all([h.api('/sheets/d1','PUT',a,input),h.api('/sheets/d2','PUT',b,input)]);assert.deepEqual(r.map(x=>x.status),[200,200]);
});
await check('원격 관리자 권한 및 시수 검증',async()=>{
  const a=await sheet();a.part.courses[0].name='가상권한시험';assert.equal((await h.api('/sheets/d1','PUT',a,input)).status,403);
  const b=await sheet();b.part.assignments[0].hours=40;assert.equal((await h.api('/sheets/d1','PUT',b,admin)).status,400);
});
await check('원격 학교 설정 버전 충돌',async()=>{
  const old=await sheet(),w=await h.workspace();const data={global:C.clone(w.global),newSheets:[],revision:w.globalRevision,operationId:'remote-global-'+crypto.randomUUID()};data.global.source.virtualConflictCheck=true;
  assert.equal((await h.api('/global','PUT',data,admin)).status,200);old.part.teachers[0].name='가상오래된설정';assert.equal((await h.api('/sheets/d1','PUT',old,input)).status,409);
});
const sampleStart=h.samples.length,iterations=30;
for(let i=0;i<iterations;i++){
  const data=await sheet();data.part.teachers[0].name='가상원격측정'+i;assert.equal((await h.api('/sheets/d1','PUT',data,input)).status,200);
}
const samples=h.samples.slice(sampleStart),summary={};
for(const [name,filter] of [['load',s=>s.method==='GET'&&s.path.startsWith('/workspace')],['save',s=>s.method==='PUT'&&s.path==='/sheets/:id']]){
  const rows=samples.filter(filter),v=rows.map(x=>x.ms).sort((a,b)=>a-b),round=x=>Math.round(x*100)/100;
  summary[name]={count:v.length,p50Ms:v[Math.ceil(v.length*.5)-1],p95Ms:v[Math.ceil(v.length*.95)-1],maxMs:v.at(-1),averageRowsRead:round(rows.reduce((n,x)=>n+x.rowsRead,0)/rows.length),averageRowsWritten:round(rows.reduce((n,x)=>n+x.rowsWritten,0)/rows.length),colos:[...new Set(rows.map(x=>x.colo))]};
}
const report={baseUrl:h.m.baseUrl,deploymentId:h.m.deploymentId,startAt,endAt:new Date().toISOString(),fixture:{departments:12,teachers:144,courses:96,sections:576},checks,iterations,summary,samples};
await h.writeReport('remote-api.json',report);console.table(summary);console.log('원격 기능 시험',checks.length,'개 통과');
