import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {manifest,credentials,assertTestTarget,saveManifest,cloudflare} from '../scripts/cloudflare-client.mjs';
import {preparePasswordRequest} from '../shared/password.js';
import * as S from '../shared/state.js';
import * as C from '../shared/domain.js';
import {demoState} from './fixtures/demo.js';

export async function createRemoteHarness({seed=true}={}){
  const m=await manifest();assertTestTarget(m);
  if(!m.projectCreatedByThisRun||!m.initializedByThisRun||!m.deploymentId||m.baseUrl!=='https://course-allocation-test.pages.dev')throw new Error('확인된 시험 배포만 시험할 수 있습니다.');
  const deployments=await cloudflare(`/accounts/${m.accountId}/pages/projects/${m.projectName}/deployments`);
  const active=deployments.find(d=>d.environment==='production'&&d.latest_stage.status==='success');
  if(active?.id!==m.deploymentId)throw new Error('기록한 시험 배포와 현재 활성 배포가 다릅니다.');
  const secrets=(await credentials()).production,samples=[];
  let accessToken,adminToken,requests=0;
  async function api(path,method='GET',data,token){
    if(!/^\/(access|auth|workspace|state|sheets|global)(\/|\?|$)/.test(path))throw new Error('허용되지 않은 시험 API');
    data=await preparePasswordRequest(path,data,async p=>{const r=await api(p,'GET',undefined,token);if(!r.ok)throw new Error('인증 매개변수 요청 실패: '+r.status);return r.data;});
    if(++requests>500)throw new Error('시험 요청 상한 500회 초과');
    const start=performance.now(),response=await fetch(m.baseUrl+'/api'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(method==='GET'?{}:{'Content-Type':'application/json'})},...(method==='GET'?{}:{body:JSON.stringify(data??{})}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
    const result=await response.json();samples.push({path:path.replace(/\/sheets\/[^/?]+/,'/sheets/:id'),method,status:response.status,ms:Math.round((performance.now()-start)*100)/100,serverTiming:response.headers.get('server-timing'),rowsRead:Number(response.headers.get('x-d1-rows-read')),rowsWritten:Number(response.headers.get('x-d1-rows-written')),colo:response.headers.get('cf-ray')?.split('-').at(-1)});
    return {response,status:response.status,...result};
  }
  const requireOk=result=>{if(!result.ok)throw new Error('시험 API 실패: '+result.status+' '+(result.code||''));return result.data;};
  async function login(admin=false){
    if(!accessToken){accessToken=requireOk(await api('/access/login','POST',{code:secrets.accessPassword,includeState:true})).accessToken;}
    if(!admin)return accessToken;
    if(!adminToken)adminToken=requireOk(await api('/auth/login','POST',{password:secrets.adminPassword},accessToken)).adminToken;
    return adminToken;
  }
  async function workspace(){return requireOk(await api('/workspace?all=true','GET',undefined,await login(true)));}
  async function revision(id){const w=requireOk(await api('/workspace?departmentId='+encodeURIComponent(id),'GET',undefined,await login(true)));return w.revisions[id];}
  async function savePart(part,version,globalVersion,token=adminToken,operation='remote-'+crypto.randomUUID()){
    return requireOk(await api('/sheets/'+part.department.id,'PUT',{part,revision:version,globalRevision:globalVersion,operationId:operation},token));
  }
  async function seedState(state){
    C.assertState(state);let w=await workspace();
    const ours=w.global.source?.deploymentTestId===m.marker;
    const initial=w.departments.length===1&&w.parts.every(p=>!p.teachers.length&&!p.courses.length&&!p.groups.length&&!p.assignments.length&&!p.unmapped.length);
    if(!ours&&!initial)throw new Error('시험 표시가 없는 기존 자료는 변경하지 않습니다.');
    if(!ours&&m.remoteDataInitialized)throw new Error('기존 시험 표시가 사라져 변경을 중단합니다.');
    // Explicitly discard only this run's virtual records before changing school structure.
    for(const part of w.parts){
      const empty={department:{...part.department,status:'draft',sourceTotal:null,note:''},teachers:[],courses:[],groups:[],assignments:[],unmapped:[]};
      await savePart(empty,w.revisions[part.department.id],w.globalRevision);
    }
    w=await workspace();state=C.clone(state);state.source={...state.source,fixture:true,deploymentTestId:m.marker};
    const global=S.globalPart(state),added=state.departments.filter(d=>!w.global.departmentIds.includes(d.id)).map(d=>S.departmentPart(state,d.id));
    requireOk(await api('/global','PUT',{global,newSheets:added,revision:w.globalRevision,operationId:'remote-global-'+crypto.randomUUID()},adminToken));
    w=await workspace();for(const d of state.departments){await savePart(S.departmentPart(state,d.id),w.revisions[d.id],w.globalRevision);}
    m.remoteDataInitialized=true;m.lastFixture={departments:state.departments.length,teachers:state.teachers.length,courses:state.courses.length,sections:state.groups.reduce((n,g)=>n+g.slots.length,0)};await saveManifest(m);
  }
  if(seed)await seedState(demoState());
  return {remote:true,m,api,login,workspace,revision,savePart,seedState,samples,requireOk,passwords:{access:secrets.accessPassword,admin:secrets.adminPassword},
    async listen(){return m.baseUrl;},async close(){},
    async writeReport(name,report){await mkdir('test-results/cloudflare',{recursive:true});await writeFile('test-results/cloudflare/'+name,JSON.stringify(report,null,2)+'\n');}
  };
}
