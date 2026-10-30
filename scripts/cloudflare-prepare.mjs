import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {cloudflare,git,manifestPath,credentialsPath,saveManifest,assertTestTarget,sql} from './cloudflare-client.mjs';
import {randomToken,provisionCredential} from '../server/crypto.js';

const accountId='965071bae1ca798003675034b0ce7ce5',projectName='course-allocation-test';
let m;
try{m=JSON.parse(await readFile(manifestPath,'utf8'));}catch{
  m={accountId,projectName,databaseId:'216a677e-9ae1-461d-b451-da63aa27f54a',databaseName:'course-allocation-test-db',productionBranch:'cloudflare-test',mainRevision:git('rev-parse','main'),startingRevision:git('rev-parse','HEAD'),marker:'virtual-'+crypto.randomUUID(),createdAt:new Date().toISOString()};
}
assertTestTarget(m);
const prefix='/accounts/'+accountId;
const database=await cloudflare(prefix+'/d1/database/'+m.databaseId);
if(database.name!==m.databaseName)throw new Error('시험 D1 이름이 일치하지 않습니다.');
const tables=await sql(m,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
const existingTables=tables[0].results.map(row=>row.name);
if(existingTables.length&&!m.initializedByThisRun)throw new Error('시험 D1에 기존 테이블이 있어 자동 초기화를 중단합니다.');
console.log('시험 DB 확인:',database.name,'기존 앱 테이블',existingTables.length);
let project=await cloudflare(prefix+'/pages/projects/'+projectName,{allow404:true});
if(project&&!m.projectCreatedByThisRun)throw new Error('같은 이름의 기존 Pages 프로젝트가 있어 자동 변경을 중단합니다.');
if(!project){
  project=await cloudflare(prefix+'/pages/projects',{method:'POST',body:{name:projectName,production_branch:'cloudflare-test'}});
  m.projectCreatedByThisRun=true;await saveManifest(m);
}
if(project.production_branch!=='cloudflare-test')throw new Error('Pages 기준 브랜치가 시험 브랜치가 아닙니다.');
let preview;
if(m.previewDatabaseId)preview=await cloudflare(prefix+'/d1/database/'+m.previewDatabaseId);
else{
  preview=await cloudflare(prefix+'/d1/database',{method:'POST',body:{name:'course-allocation-preview-db',primary_location_hint:'apac'}});
  m.previewDatabaseId=preview.uuid;m.previewDatabaseName=preview.name;await saveManifest(m);
}
let c;
try{c=JSON.parse(await readFile(credentialsPath,'utf8'));}catch{
  c={};for(const environment of ['production','preview']){
    const pepper=randomToken(),accessPassword='TestA-'+randomToken().slice(0,24),adminPassword='TestM-'+randomToken().slice(0,24);
    c[environment]={accessPassword,adminPassword,PASSWORD_PEPPER:pepper,BOOTSTRAP_ACCESS_HASH:await provisionCredential(accessPassword,pepper,'access'),BOOTSTRAP_ADMIN_HASH:await provisionCredential(adminPassword,pepper,'admin')};
  }
  await mkdir('.cache/cloudflare-test',{recursive:true});await writeFile(credentialsPath,JSON.stringify(c,null,2)+'\n');
}
const configuration={};
for(const environment of ['production','preview']){
  const values=c[environment];configuration[environment]={compatibility_date:'2026-07-30',compatibility_flags:[],
    d1_databases:{DB:{id:environment==='production'?m.databaseId:m.previewDatabaseId}},
    env_vars:Object.fromEntries(['PASSWORD_PEPPER','BOOTSTRAP_ACCESS_HASH','BOOTSTRAP_ADMIN_HASH'].map(key=>[key,{type:'secret_text',value:values[key]}]))};
}
await cloudflare(prefix+'/pages/projects/'+projectName,{method:'PATCH',body:{deployment_configs:configuration}});
const config={$schema:'./node_modules/wrangler/config-schema.json',name:projectName,pages_build_output_dir:'./dist',compatibility_date:'2026-07-30',
  d1_databases:[{binding:'DB',database_name:m.databaseName,database_id:m.databaseId,migrations_dir:'migrations'}],
  env:{preview:{d1_databases:[{binding:'DB',database_name:m.previewDatabaseName,database_id:m.previewDatabaseId,migrations_dir:'migrations'}]}}};
const original=await readFile('wrangler.jsonc','utf8');
try{await writeFile('.cache/cloudflare-test/wrangler.before.jsonc',original,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
const previous=JSON.parse(original);
if(previous.name!==projectName||previous.d1_databases?.[0]?.database_id!==m.databaseId)throw new Error('기존 시험 설정의 대상이 다릅니다.');
const {account_id:unused,...supportedPrevious}=previous;
await writeFile('wrangler.jsonc',JSON.stringify({...supportedPrevious,...config,env:{...previous.env,...config.env}},null,2)+'\n');
m.baseUrl='https://'+project.subdomain;m.preparedAt=new Date().toISOString();await saveManifest(m);
// This query reads plan names only, never billing amounts or payment details.
try{const subscriptions=await cloudflare(prefix+'/subscriptions');m.workerPlans=subscriptions.filter(x=>/worker/i.test(x.rate_plan?.name??x.rate_plan?.id??'')).map(x=>({id:x.rate_plan?.id,name:x.rate_plan?.name}));await saveManifest(m);}catch(e){m.planInspection={status:e.status??'unavailable'};await saveManifest(m);}
console.log('새 시험 프로젝트 준비 완료:',m.projectName,m.baseUrl);
console.log('시험 D1:',m.databaseName,'미리보기 D1:',m.previewDatabaseName);
console.log('개별 시험 비밀번호는 Git에서 제외한 로컬 credentials 파일에 저장했습니다.');
