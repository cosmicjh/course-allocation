import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';
import * as C from '../shared/domain.js';
import * as S from '../shared/state.js';
import {assemble} from '../server/validation.js';

let h,input,admin;
before(async()=>{try{h=await createHarness();input=await h.login();admin=await h.login(true);}catch(error){console.error(error);throw error;}});
after(async()=>{await h?.close();});
const op=()=> 'test-'+crypto.randomUUID();
async function sheet(id='d1'){
  const r=await h.api('/workspace?departmentId='+id,'GET',undefined,admin);assert.equal(r.status,200);
  return {part:r.data.parts[0],revision:r.data.revisions[id],globalRevision:r.data.globalRevision,operationId:op()};
}
test('authentication, origin checks and no-store timing headers',async()=>{
  assert.equal((await h.api('/workspace')).status,401);
  assert.equal((await h.api('/access/login','POST',{code:'wrong'})).status,401);
  assert.equal((await h.api('/access/login','POST',{code:'virtual-access-2026'},undefined,{Origin:'https://foreign.example'})).status,403);
  const r=await h.api('/workspace','GET',undefined,input);assert.equal(r.status,200);assert.equal(r.data.parts.length,1);assert.equal(r.data.departments.length,2);
  assert.equal(r.response.headers.get('cache-control'),'no-store');assert.match(r.response.headers.get('server-timing'),/db;dur=/);
  const all=await h.api('/workspace?all=true','GET',undefined,input);assert.equal(all.data.parts.length,2);
});
test('same-department concurrent saves yield one success and one conflict; retry is idempotent',async()=>{
  const a=await sheet(),b=C.clone(a);a.part.teachers[0].name='가상동시A';b.part.teachers[0].name='가상동시B';b.operationId=op();
  const results=await Promise.all([h.api('/sheets/d1','PUT',a,input),h.api('/sheets/d1','PUT',b,input)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner=results[0].ok?a:b,first=results.find(r=>r.ok),retry=await h.api('/sheets/d1','PUT',winner,input);
  assert.equal(retry.data.revision,first.data.revision);
  const tampered=C.clone(winner);tampered.part.teachers[0].name='가상다른요청';assert.equal((await h.api('/sheets/d1','PUT',tampered,input)).status,409);
});
test('independent departments save concurrently',async()=>{
  const a=await sheet('d1'),b=await sheet('d2');a.part.teachers[0].name='가상분리1';b.part.teachers[0].name='가상분리2';
  const results=await Promise.all([h.api('/sheets/d1','PUT',a,input),h.api('/sheets/d2','PUT',b,input)]);assert.deepEqual(results.map(r=>r.status),[200,200]);
});
test('simultaneous delivery of the same operation advances the version once',async()=>{
  const a=await sheet();a.part.teachers[0].isLead=true;
  const results=await Promise.all([h.api('/sheets/d1','PUT',a,input),h.api('/sheets/d1','PUT',a,input)]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(results[0].data.revision,results[1].data.revision);
  assert.equal((await sheet()).revision,a.revision+1);
});
test('server rejects unauthorized structure changes and invalid hours',async()=>{
  const a=await sheet();a.part.courses[0].name='가상위조';assert.equal((await h.api('/sheets/d1','PUT',a,input)).status,403);
  const b=await sheet();b.part.assignments[0].hours=40;assert.equal((await h.api('/sheets/d1','PUT',b,admin)).status,400);
  const c=await sheet();c.part.department.status='locked';assert.equal((await h.api('/sheets/d1','PUT',c,input)).status,403);
});
test('IDs cannot collide with another department even in a valid local document',async()=>{
  const a=await sheet();a.part.teachers[0].id='teacher-d2';a.part.assignments.forEach(row=>row.teacherId='teacher-d2');
  assert.equal((await h.api('/sheets/d1','PUT',a,input)).status,400);assert.equal((await sheet()).revision,a.revision);
  const b=await sheet();b.part.groups[0].id='group-d2';assert.equal((await h.api('/sheets/d1','PUT',b,admin)).status,400);
});
test('submission locks editing; only an administrator can reopen',async()=>{
  const a=await sheet();a.part.department.status='submitted';assert.equal((await h.api('/sheets/d1','PUT',a,input)).status,200);
  const b=await sheet();b.part.teachers[0].name='가상잠금위조';assert.equal((await h.api('/sheets/d1','PUT',b,input)).status,403);
  const c=await sheet();c.part.department.status='draft';assert.equal((await h.api('/sheets/d1','PUT',c,input)).status,403);assert.equal((await h.api('/sheets/d1','PUT',c,admin)).status,200);
});
test('global batch CAS is atomic, invalidates old sheet versions, and is idempotent',async()=>{
  const old=await sheet(),w=(await h.api('/workspace?all=true','GET',undefined,admin)).data;
  const a={revision:w.globalRevision,global:C.clone(w.global),newSheets:[],operationId:op()},b=C.clone(a);a.global.source.virtual='A';b.global.source.virtual='B';b.operationId=op();
  const results=await Promise.all([h.api('/global','PUT',a,admin),h.api('/global','PUT',b,admin)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner=results[0].ok?a:b;assert.equal((await h.api('/global','PUT',winner,admin)).data.globalRevision,w.globalRevision+1);
  old.part.teachers[0].name='가상오래된설정';assert.equal((await h.api('/sheets/d1','PUT',old,input)).status,409);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM write_guards').first()).n,0);
  const nonadmin={...winner,operationId:op()};assert.equal((await h.api('/global','PUT',nonadmin,input)).status,403);
});
test('new department creation and global metadata commit together',async()=>{
  const w=(await h.api('/workspace?all=true','GET',undefined,admin)).data,part={department:{id:'d3',name:'가상신규',status:'draft',sourceTotal:null,note:''},teachers:[],courses:[],groups:[],assignments:[],unmapped:[]};
  const data={revision:w.globalRevision,global:{...w.global,departmentIds:[...w.global.departmentIds,'d3']},newSheets:[part],operationId:op()};
  assert.equal((await h.api('/global','PUT',data,admin)).status,200);
  const current=await h.api('/workspace?departmentId=d3','GET',undefined,input);assert.equal(current.data.parts[0].department.name,'가상신규');
});
test('competing global creations never leave an orphan department',async()=>{
  const w=(await h.api('/workspace?all=true','GET',undefined,admin)).data;
  const make=id=>({revision:w.globalRevision,operationId:op(),global:{...w.global,departmentIds:[...w.global.departmentIds,id]},newSheets:[{department:{id,name:'가상경합'+id,status:'draft',sourceTotal:null,note:''},teachers:[],courses:[],groups:[],assignments:[],unmapped:[]}]});
  const results=await Promise.all([h.api('/global','PUT',make('d4'),admin),h.api('/global','PUT',make('d5'),admin)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const latest=(await h.api('/workspace?all=true','GET',undefined,admin)).data;
  assert.equal(latest.parts.length,w.parts.length+1);assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM sheets').first()).n,latest.parts.length);
});
test('global write guard rejects a sheet snapshot that changed after validation',async()=>{
  const a=await sheet();a.part.teachers[0].isLead=!a.part.teachers[0].isLead;assert.equal((await h.api('/sheets/d1','PUT',a,input)).status,200);
  await assert.rejects(h.db.prepare('INSERT INTO write_guards(id,sheet_revisions) VALUES (?,?)').bind('virtual-stale-guard',JSON.stringify({d1:a.revision})).run(),/sheet_conflict/);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM write_guards').first()).n,0);
});
test('input mode can map original names and resolve legacy allocations',async()=>{
  let data=await sheet();data.part.assignments[0].hours=2;data.part.unmapped=[{id:'virtual-unmapped',deptId:'d1',teacherId:'teacher-d1',sourceName:'가상원본과목',grade:2,label:'2A',kind:'moving',hours:1}];
  assert.equal((await h.api('/sheets/d1','PUT',data,admin)).status,200);
  let global=(await h.api('/workspace','GET',undefined,input)).data.global;data=await sheet();let state=assemble(global,[data.part]);C.mapSourceName(state,'d1','가상원본과목','course-d1');data.part=S.departmentPart(state,'d1');
  assert.equal((await h.api('/sheets/d1','PUT',data,input)).status,200);
  data=await sheet();state=assemble(global,[data.part]);C.rebuildGroup(state,'group-d1',2,3);data.part=S.departmentPart(state,'d1');assert.equal((await h.api('/sheets/d1','PUT',data,admin)).status,200);
  data=await sheet();state=assemble(global,[data.part]);const group=state.groups[0];C.resolvePool(state,group.id,[{teacherId:'teacher-d1',sectionId:group.slots[0].id,hours:1},{teacherId:'teacher-d1',sectionId:group.slots[1].id,hours:2}]);data.part=S.departmentPart(state,'d1');assert.equal((await h.api('/sheets/d1','PUT',data,input)).status,200);
});
test('oversized department documents are rejected before database writes',async()=>{
  const data=await sheet();data.part.department.note='x'.repeat(1500001);assert.equal((await h.api('/sheets/d1','PUT',data,admin)).status,413);assert.equal((await sheet()).revision,data.revision);
});
test('password rotation revokes old sessions but preserves the active administrator',async()=>{
  const r=await h.api('/access/password','POST',{current:'virtual-admin-2026',password:'virtual-new-access'},admin);assert.equal(r.status,200);
  assert.equal((await h.api('/workspace','GET',undefined,input)).status,401);assert.equal((await h.api('/workspace','GET',undefined,admin)).status,401);
  admin=r.data.adminToken;input=r.data.accessToken;assert.equal((await h.api('/workspace','GET',undefined,admin)).status,200);
  const change=await h.api('/auth/password','POST',{current:'virtual-admin-2026',password:'virtual-new-admin'},admin);assert.equal(change.status,200);
  assert.equal((await h.api('/workspace','GET',undefined,admin)).status,403);admin=change.data.adminToken;
  assert.equal((await h.api('/auth/logout','POST',{},admin)).status,200);assert.equal((await h.api('/workspace','GET',undefined,admin)).status,401);
});
test('login attempts are bounded and malformed/oversized payloads are rejected',async()=>{
  for(let i=0;i<11;i++){const r=await h.api('/access/login','POST',{code:'wrong'},undefined,{'CF-Connecting-IP':'virtual-abuse'});assert.equal(r.status,i===10?429:401);}
  const response=await h.mf.dispatchFetch('http://localhost/api/access/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(response.status,400);
});
