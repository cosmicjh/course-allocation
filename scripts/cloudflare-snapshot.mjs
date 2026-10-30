import {cloudflare,manifest,credentials,assertTestTarget,saveManifest,sql,git} from './cloudflare-client.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const m=await manifest();assertTestTarget(m);
const prefix='/accounts/'+m.accountId;
const [project,productionDb,previewDb,originalProject]=await Promise.all([
  cloudflare(prefix+'/pages/projects/'+m.projectName),cloudflare(prefix+'/d1/database/'+m.databaseId),
  cloudflare(prefix+'/d1/database/'+m.previewDatabaseId),cloudflare(prefix+'/pages/projects/course-allocation')
]);
assert.equal(project.production_branch,'cloudflare-test');
assert.equal(project.deployment_configs.production.d1_databases.DB.id,m.databaseId);
assert.equal(project.deployment_configs.preview.d1_databases.DB.id,m.previewDatabaseId);
const result=await sql(m,`SELECT
  COUNT(*) AS departments,
  SUM(json_array_length(payload,'$.teachers')) AS teachers,
  SUM(json_array_length(payload,'$.courses')) AS courses,
  SUM(json_array_length(payload,'$.assignments')) AS assignments,
  SUM(length(CAST(payload AS BLOB))) AS document_bytes,
  (SELECT COUNT(*) FROM entity_ids) AS indexed_ids,
  (SELECT COUNT(*) FROM operations) AS operation_records,
  (SELECT json_extract(payload,'$.source.fixture') FROM workspace WHERE id=1) AS virtual_fixture,
  (SELECT json_extract(payload,'$.source.deploymentTestId') FROM workspace WHERE id=1) AS test_marker,
  (SELECT COUNT(*) FROM sheets s,json_each(s.payload,'$.teachers') t WHERE json_extract(t.value,'$.name') NOT LIKE '가상%') AS non_virtual_teachers
  FROM sheets`);
const stats=result[0].results[0];assert.equal(stats.test_marker,m.marker);assert.equal(stats.virtual_fixture,1);assert.equal(stats.non_virtual_teachers,0);
delete stats.test_marker;
const trace=JSON.parse(await readFile('test-results/cloudflare/live-tail.json','utf8'));
assert.equal(trace.deploymentId,m.deploymentId);
const cpu={};for(const [name,predicate] of [['load',e=>e.path==='/api/workspace'],['save',e=>e.path?.startsWith('/api/sheets/')],['global',e=>e.path==='/api/global'],['all',()=>true]]){
  const events=trace.events.filter(predicate),v=events.map(e=>e.cpuTimeMs??e.cpuTime).filter(Number.isFinite).sort((a,b)=>a-b);
  cpu[name]={samples:v.length,p50Ms:v[Math.ceil(v.length*.5)-1]??null,p95Ms:v[Math.ceil(v.length*.95)-1]??null,maxMs:v.at(-1)??null,outcomes:[...new Set(events.map(e=>e.outcome))]};
}
const health=await fetch(m.baseUrl+'/api/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
const s=await credentials();
await writeFile('.cache/cloudflare-test/LOGIN.local.md',[
  '# Cloudflare 시험 앱 접속 정보 — 로컬 전용','',
  '이 파일은 Git과 배포 산출물에서 제외합니다. 아래 값은 시험 앱용이며 Cloudflare 계정 비밀번호와 무관합니다.','',
  '시험 주소: '+m.baseUrl,'','접속 비밀번호: `'+s.production.accessPassword+'`','',
  '관리자 비밀번호: `'+s.production.adminPassword+'`','',
  '미리보기: https://cloudflare-test-preview.course-allocation-test.pages.dev','',
  '미리보기 접속 비밀번호: `'+s.preview.accessPassword+'`','',
  '미리보기 관리자 비밀번호: `'+s.preview.adminPassword+'`',''
].join('\n'));
m.freePlanEvidence={source:'Cloudflare dashboard: Workers 요금제',url:'https://dash.cloudflare.com/'+m.accountId+'/workers/plans',observed:'무료 — US$0 — 현재 요금제',verifiedDate:'2026-10-30'};
await saveManifest(m);
const report={verifiedAt:new Date().toISOString(),project:m.projectName,baseUrl:m.baseUrl,deploymentUrl:m.deploymentUrl,deploymentId:m.deploymentId,sourceRevision:m.sourceRevision,
  mainUnchanged:git('rev-parse','main')===m.mainRevision,mainRevision:m.mainRevision,stats,cpu,
  database:{name:productionDb.name,id:m.databaseId,bytes:productionDb.file_size},previewDatabase:{name:previewDb.name,id:m.previewDatabaseId,bytes:previewDb.file_size},
  originalProject:{name:originalProject.name,latestDeploymentId:originalProject.latest_deployment?.id,latestDeploymentCreatedAt:originalProject.latest_deployment?.created_on},freePlanEvidence:m.freePlanEvidence};
await mkdir('test-results/cloudflare',{recursive:true});await writeFile('test-results/cloudflare/final-snapshot.json',JSON.stringify(report,null,2)+'\n');
const browser=JSON.parse(await readFile('test-results/cloudflare/browser.json','utf8'));
assert.equal(browser.deploymentId,m.deploymentId,'브라우저 보고서도 현재 활성 시험 배포여야 합니다.');
console.log(JSON.stringify(report,null,2));
