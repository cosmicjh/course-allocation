import * as C from '../shared/domain.js';
import * as S from '../shared/state.js';
import {digest,randomToken,credentialFromProof,passwordMatches,publicParameters,validHash} from './crypto.js';
import {fail,boundedJson,revision,operationId,assemble,validatePart,validateGlobal,authorizePart} from './validation.js';

const HOUR=3600000, DAY=24*HOUR;
function store(db) {
  const stats={ms:0,read:0,written:0};
  const count=results=>{for(const r of results){stats.read+=r.meta?.rows_read??0;stats.written+=r.meta?.rows_written??0;}};
  const statement=(sql,args)=>db.prepare(sql).bind(...args);
  return {stats,
    async all(sql,...args){const t=performance.now();try{const r=await statement(sql,args).all();count([r]);return r.results;}finally{stats.ms+=performance.now()-t;}},
    async first(sql,...args){return (await this.all(sql,...args))[0]??null;},
    async batch(items){const t=performance.now();try{const r=await db.batch(items.map(([sql,...args])=>statement(sql,args)));count(r);return r.map(x=>x.results);}finally{stats.ms+=performance.now()-t;}}
  };
}
async function body(request) {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail(415,'invalid_type','JSON 요청이 필요합니다.');
  if(Number(request.headers.get('content-length'))>5000000)fail(413,'too_large','요청은 5MB 이하로 나누어 주세요.');
  const reader=request.body?.getReader();if(!reader)fail(400,'invalid_json','요청 자료가 없습니다.');
  const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>5000000){await reader.cancel();fail(413,'too_large','요청은 5MB 이하로 나누어 주세요.');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data;}
  catch{fail(400,'invalid_json','JSON 형식이 올바르지 않습니다.');}
}
async function credentials(s,env,bootstrap=false) {
  let rows=await s.all('SELECT * FROM credentials');
  if(rows.length!==2 && bootstrap){
    if(!validHash(env.BOOTSTRAP_ACCESS_HASH)||!validHash(env.BOOTSTRAP_ADMIN_HASH))fail(503,'setup_required','서버의 초기 비밀번호 해시 설정이 필요합니다.');
    await s.batch([
      ['INSERT OR IGNORE INTO credentials(kind,password_hash) VALUES (?,?)','access',env.BOOTSTRAP_ACCESS_HASH],
      ['INSERT OR IGNORE INTO credentials(kind,password_hash) VALUES (?,?)','admin',env.BOOTSTRAP_ADMIN_HASH]
    ]);
    rows=await s.all('SELECT * FROM credentials');
  }
  return Object.fromEntries(rows.map(row=>[row.kind,row]));
}
async function limitLogin(s,request,now) {
  const ip=request.headers.get('CF-Connecting-IP')||'local';
  const bucket=await digest(`${ip}:${Math.floor(now/60000)}`);
  const row=await s.first('INSERT INTO login_limits(bucket,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts',bucket,now+120000);
  if(row.attempts>10)fail(429,'rate_limited','로그인 시도가 많습니다. 1분 후 다시 시도하세요.');
}
async function authenticate(s,request,now) {
  const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!token)fail(401,'access_required','접속 비밀번호로 로그인하세요.');
  const session=await s.first(`SELECT s.*,
    (SELECT epoch FROM credentials WHERE kind='access') AS current_access,
    (SELECT epoch FROM credentials WHERE kind='admin') AS current_admin
    FROM sessions s WHERE token_hash=?`,await digest(token));
  if(!session || session.expires_at<=now || session.access_epoch!==session.current_access)fail(401,'access_required','접속이 만료되었습니다. 다시 로그인하세요.');
  if(session.role==='admin'&&session.admin_epoch!==session.current_admin)fail(403,'admin_required','관리자 접속이 만료되었습니다. 다시 로그인하세요.');
  return session;
}
const requireAdmin=session=>{if(session.role!=='admin')fail(403,'admin_required','관리자 모드에서 실행하세요.');};
async function newSession(cred,role,now) {
  const token=randomToken(),hash=await digest(token);
  return {token,sql:['INSERT INTO sessions(token_hash,role,access_epoch,admin_epoch,expires_at) VALUES (?,?,?,?,?)',hash,role,cred.access.epoch,cred.admin.epoch,now+(role==='admin'?2*HOUR:12*HOUR)]};
}
function guard(id,globalRevision=null,accessEpoch=null,adminEpoch=null,sheetRevisions=null){return ['INSERT INTO write_guards(id,global_revision,access_epoch,admin_epoch,sheet_revisions) VALUES (?,?,?,?,?)',id,globalRevision,accessEpoch,adminEpoch,sheetRevisions];}
async function workspace(s,options={},admin=false) {
  const all=options.all===true||options.all==='true';
  // Both results come from the same D1 batch transaction/snapshot.
  const [globals,rows]=await s.batch([
    ['SELECT payload,revision FROM workspace WHERE id=1'],
    ['SELECT id,revision,json_extract(payload,\'$.department\') AS department, CASE WHEN ? OR id=COALESCE(?,(SELECT json_extract(payload,\'$.departmentIds[0]\') FROM workspace WHERE id=1)) THEN payload ELSE NULL END AS payload FROM sheets',all?1:0,options.departmentId??null]
  ]);
  const global=JSON.parse(globals[0].payload),byId=new Map(rows.map(r=>[r.id,r]));
  const ordered=global.departmentIds.map(id=>byId.get(id));
  if(ordered.some(r=>!r))fail(500,'invalid_database','학교 설정과 교과군 자료가 일치하지 않습니다.');
  const selected=options.departmentId??global.departmentIds[0];
  if(!byId.has(selected))fail(404,'not_found','교과군을 찾을 수 없습니다.');
  const parts=ordered.filter(r=>r.payload).map(r=>JSON.parse(r.payload));
  return {partial:true,global,departments:ordered.map(r=>JSON.parse(r.department)),parts,
    selectedDepartmentId:selected,globalRevision:globals[0].revision,revisions:Object.fromEntries(ordered.map(r=>[r.id,r.revision])),admin};
}
async function priorOperation(s,id,kind,sheetId,hash) {
  const prior=await s.first('SELECT * FROM operations WHERE id=?',id);if(!prior)return null;
  if(prior.kind!==kind || prior.sheet_id!==sheetId || prior.request_hash!==hash)fail(409,'operation_conflict','저장 작업 식별자가 다른 요청에 이미 사용되었습니다.');
  return JSON.parse(prior.result);
}
async function prune(s,now) {
  // Bounded maintenance on explicit writes, with indexed expiry lookups. No polling/cron.
  await s.batch([
    ['DELETE FROM operations WHERE id IN (SELECT id FROM operations WHERE created_at<? ORDER BY created_at LIMIT 100)',now-7*DAY],
    ['DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<? LIMIT 100)',now],
    ['DELETE FROM login_limits WHERE bucket IN (SELECT bucket FROM login_limits WHERE expires_at<? LIMIT 100)',now]
  ]);
}
async function saveSheet(s,id,data,session,now) {
  revision(data.revision);revision(data.globalRevision);operationId(data.operationId);
  boundedJson(data.part,'교과군 자료');
  const hash=await digest(JSON.stringify({id,part:data.part,revision:data.revision,globalRevision:data.globalRevision}));
  const prior=await priorOperation(s,data.operationId,'sheet',id,hash);if(prior)return prior;
  const [globals,rows]=await s.batch([['SELECT * FROM workspace WHERE id=1'],['SELECT * FROM sheets WHERE id=?',id]]);
  if(!rows[0])fail(404,'not_found','교과군을 찾을 수 없습니다.');
  if(globals[0].revision!==data.globalRevision || rows[0].revision!==data.revision){
    const done=await priorOperation(s,data.operationId,'sheet',id,hash);if(done)return done;
    if(globals[0].revision!==data.globalRevision)fail(409,'global_conflict','학교 설정이 변경되었습니다. 입력을 보존하고 최신 내용을 확인하세요.');
    fail(409,'sheet_conflict','다른 사용자가 이 교과군을 저장했습니다. 입력을 보존하고 최신 내용을 확인하세요.');
  }
  const global=JSON.parse(globals[0].payload),before=JSON.parse(rows[0].payload);
  validatePart(global,data.part,id);authorizePart(global,before,data.part,session.role==='admin');
  const identityHash=await digest(S.identityKey(data.part));
  let updated;
  try{updated=await s.first(`UPDATE sheets SET payload=?, revision=revision+1, last_operation=?,request_hash=?,updated_at=?,identity_hash=?
      WHERE id=? AND revision=? AND (SELECT revision FROM workspace WHERE id=1)=? RETURNING revision`,
    JSON.stringify(data.part),data.operationId,hash,now,identityHash,id,data.revision,data.globalRevision);}
  catch(e){const done=await priorOperation(s,data.operationId,'sheet',id,hash);if(done)return done;if(String(e).includes('entity_ids'))fail(400,'duplicate_id','다른 교과군에서 사용 중인 자료 식별자입니다.');throw e;}
  if(!updated){const done=await priorOperation(s,data.operationId,'sheet',id,hash);if(done)return done;fail(409,'save_conflict','저장 중 자료가 변경되었습니다. 입력을 보존하고 최신 내용을 확인하세요.');}
  await prune(s,now);return {revision:updated.revision};
}
async function saveGlobal(s,data,session,now) {
  requireAdmin(session);revision(data.revision);operationId(data.operationId);
  const hash=await digest(JSON.stringify({global:data.global,newSheets:data.newSheets,revision:data.revision}));
  const prior=await priorOperation(s,data.operationId,'global',null,hash);if(prior)return prior;
  const [globals,rows]=await s.batch([['SELECT * FROM workspace WHERE id=1'],['SELECT * FROM sheets']]);
  if(globals[0].revision!==data.revision){const done=await priorOperation(s,data.operationId,'global',null,hash);if(done)return done;fail(409,'global_conflict','학교 설정이 변경되었습니다. 최신 내용을 확인하세요.');}
  const oldGlobal=JSON.parse(globals[0].payload),parts=new Map(rows.map(r=>[r.id,JSON.parse(r.payload)]));
  if(!data.global||!Array.isArray(data.global.departmentIds)||!Array.isArray(data.newSheets))fail(400,'invalid_global','학교 설정 형식을 확인하세요.');
  const added=data.newSheets;
  if(new Set(added.map(p=>p?.department?.id)).size!==added.length || added.some(p=>!p?.department?.id || parts.has(p.department.id) || !data.global.departmentIds.includes(p.department.id)))
    fail(400,'invalid_global','새 교과군 목록을 확인하세요.');
  for(const part of added){validatePart(data.global,part,part.department.id);parts.set(part.department.id,part);}
  const ordered=data.global.departmentIds.map(id=>parts.get(id));
  validateGlobal(data.global,ordered);
  if(!S.same(oldGlobal.school,data.global.school) && rows.some(r=>JSON.parse(r.payload).department.status!=='draft'))
    fail(400,'sheet_locked','제출·확정된 배당표의 입력을 다시 연 후 학교 설정을 수정하세요.');
  for(const id of oldGlobal.departmentIds.filter(id=>!data.global.departmentIds.includes(id)))
    if(parts.get(id).department.status!=='draft')fail(400,'sheet_locked','제출·확정된 교과군을 삭제할 수 없습니다.');
  const result={globalRevision:data.revision+1,newRevisions:Object.fromEntries(added.map(p=>[p.department.id,1]))};
  const addedRows=await Promise.all(added.map(async part=>({part,identityHash:await digest(S.identityKey(part))})));
  const id=randomToken();
  try{await s.batch([
    guard(id,data.revision,null,null,JSON.stringify(Object.fromEntries(rows.map(r=>[r.id,r.revision])))),
    ['UPDATE workspace SET payload=?,revision=revision+1 WHERE id=1',boundedJson(data.global,'학교 설정')],
    ['INSERT INTO sheets(id,payload,revision,updated_at,identity_hash) SELECT json_extract(value,\'$.part.department.id\'),json_extract(value,\'$.part\'),1,?,json_extract(value,\'$.identityHash\') FROM json_each(?)',now,boundedJson(addedRows,'새 교과군 자료')],
    ['DELETE FROM sheets WHERE id NOT IN (SELECT value FROM json_each(?))',JSON.stringify(data.global.departmentIds)],
    ['INSERT INTO operations(id,kind,sheet_id,request_hash,result,created_at) VALUES (?,\'global\',NULL,?,?,?)',data.operationId,hash,JSON.stringify(result),now],
    ['DELETE FROM write_guards WHERE id=?',id]
  ]);}catch(e){const done=await priorOperation(s,data.operationId,'global',null,hash);if(done)return done;if(/global_conflict|sheet_conflict/.test(String(e)))fail(409,'global_conflict','학교 설정 또는 배당표가 다른 곳에서 변경되었습니다.');throw e;}
  await prune(s,now);return result;
}
async function changePassword(s,data,session,env,kind,now) {
  requireAdmin(session);
  if(!/^[a-f0-9]{64}$/.test(data.passwordProof)||!/^[a-f0-9]{32}$/.test(data.passwordSalt)||!Number.isInteger(data.passwordLength)||data.passwordLength<8||data.passwordLength>128)fail(400,'invalid_password','새 비밀번호의 계산 결과를 확인하세요.');
  const cred=await credentials(s,env);
  if(data.currentEpoch!==cred.admin.epoch)fail(409,'credential_changed','비밀번호가 변경되었습니다. 다시 시도하세요.');
  if(!await passwordMatches(data.current,cred.admin.password_hash,env.PASSWORD_PEPPER,'admin'))fail(403,'wrong_password','현재 관리자 비밀번호가 일치하지 않습니다.');
  const hash=await credentialFromProof(data.passwordProof,data.passwordSalt,kind,env.PASSWORD_PEPPER);cred[kind]={...cred[kind],epoch:cred[kind].epoch+1};
  const access=await newSession(cred,'input',now),admin=await newSession(cred,'admin',now),id=randomToken();
  try{await s.batch([
    guard(id,null,session.current_access,session.current_admin),
    ['UPDATE credentials SET password_hash=?,epoch=epoch+1 WHERE kind=?',hash,kind],access.sql,admin.sql,
    ['DELETE FROM write_guards WHERE id=?',id]
  ]);}catch(e){if(String(e).includes('auth_conflict'))fail(409,'auth_conflict','다른 관리자가 비밀번호를 변경했습니다. 다시 로그인하세요.');throw e;}
  return {accessToken:access.token,adminToken:admin.token};
}
async function route(request,env,s,now) {
  if(!/^[a-f0-9]{64}$/.test(env.PASSWORD_PEPPER||''))fail(503,'setup_required','서버 PASSWORD_PEPPER 비밀값 설정이 필요합니다.');
  const url=new URL(request.url),path=url.pathname.replace(/^\/api/,'');
  const mutating=['POST','PUT'].includes(request.method);
  if(mutating && request.headers.has('Origin') && request.headers.get('Origin')!==url.origin)fail(403,'origin_rejected','다른 사이트에서 보낸 요청은 허용하지 않습니다.');
  const data=mutating?await body(request):Object.fromEntries(url.searchParams);
  if(path==='/access/parameters'&&request.method==='GET')return publicParameters((await credentials(s,env,true)).access);
  if(path==='/access/login'&&request.method==='POST'){
    await limitLogin(s,request,now);const cred=await credentials(s,env,true);
    if(data.credentialEpoch!==cred.access.epoch)fail(409,'credential_changed','접속 비밀번호가 변경되었습니다. 다시 시도하세요.');
    if(!await passwordMatches(data.code,cred.access.password_hash,env.PASSWORD_PEPPER,'access'))fail(401,'wrong_password','접속 비밀번호가 일치하지 않습니다.');
    const session=await newSession(cred,'input',now);await s.batch([session.sql]);await prune(s,now);
    return {accessToken:session.token,...(data.includeState?{workspace:await workspace(s,{},false)}:{})};
  }
  const session=await authenticate(s,request,now);
  if(path==='/auth/parameters'&&request.method==='GET')return publicParameters((await credentials(s,env)).admin);
  if(path==='/workspace'&&request.method==='GET')return workspace(s,data,session.role==='admin');
  if(path==='/state'&&request.method==='GET'){
    const w=await workspace(s,{all:true},session.role==='admin');
    return {state:assemble(w.global,w.parts),globalRevision:w.globalRevision,revisions:w.revisions,admin:w.admin};
  }
  if(path==='/auth/login'&&request.method==='POST'){
    await limitLogin(s,request,now);const cred=await credentials(s,env);
    if(data.credentialEpoch!==cred.admin.epoch)fail(409,'credential_changed','관리자 비밀번호가 변경되었습니다. 다시 시도하세요.');
    if(!await passwordMatches(data.password,cred.admin.password_hash,env.PASSWORD_PEPPER,'admin'))fail(401,'wrong_password','관리자 비밀번호가 일치하지 않습니다.');
    const admin=await newSession(cred,'admin',now);await s.batch([admin.sql]);return {adminToken:admin.token};
  }
  if(path==='/auth/logout'&&request.method==='POST'){
    if(session.role==='admin')await s.all('DELETE FROM sessions WHERE token_hash=?',session.token_hash);return {};
  }
  if(path==='/auth/password'&&request.method==='POST')return changePassword(s,data,session,env,'admin',now);
  if(path==='/access/password'&&request.method==='POST')return changePassword(s,data,session,env,'access',now);
  if(path==='/global'&&request.method==='PUT')return saveGlobal(s,data,session,now);
  const sheet=path.match(/^\/sheets\/([A-Za-z0-9_-]{1,100})$/);
  if(sheet&&request.method==='PUT')return saveSheet(s,sheet[1],data,session,now);
  fail(404,'not_found','요청한 API를 찾을 수 없습니다.');
}
export async function handleRequest(request,env) {
  const start=performance.now(),s=env.DB?store(env.DB):null;let payload,status=200;
  try{if(!s)fail(503,'setup_required','D1 DB 바인딩 설정이 필요합니다.');payload={ok:true,data:await route(request,env,s,Date.now())};}
  catch(e){status=e.status||500;payload={ok:false,status,code:e.code||'server_error',message:status===500?'서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.':e.message};if(status===500)console.error('Allocation API error:',e.stack);}
  return Response.json(payload,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Server-Timing':`app;dur=${(performance.now()-start).toFixed(2)}, db;dur=${(s?.stats.ms??0).toFixed(2)}`,
    'X-D1-Rows-Read':String(s?.stats.read??0),'X-D1-Rows-Written':String(s?.stats.written??0),...(status===429?{'Retry-After':'60'}:{})}});
}
