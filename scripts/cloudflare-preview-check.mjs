import {cloudflare,manifest,credentials,assertTestTarget,saveManifest} from './cloudflare-client.mjs';
import {preparePasswordRequest} from '../shared/password.js';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const m=await manifest();assertTestTarget(m);
const project=await cloudflare(`/accounts/${m.accountId}/pages/projects/${m.projectName}`);
assert.equal(project.production_branch,'cloudflare-test');
assert.equal(project.deployment_configs.production.d1_databases.DB.id,m.databaseId);
assert.equal(project.deployment_configs.preview.d1_databases.DB.id,m.previewDatabaseId);
assert.notEqual(m.databaseId,m.previewDatabaseId);
const deployments=await cloudflare(`/accounts/${m.accountId}/pages/projects/${m.projectName}/deployments`);
const preview=deployments.find(d=>d.environment==='preview'&&d.deployment_trigger?.metadata?.branch==='cloudflare-test-preview');
assert.ok(preview);assert.equal(preview.latest_stage.status,'success');
const baseUrl=preview.url;
assert.ok(new URL(baseUrl).hostname.endsWith('.'+m.projectName+'.pages.dev'));
const secret=(await credentials()).preview;
async function api(path,method='GET',data,token){
  data=await preparePasswordRequest(path,data,async p=>(await api(p)).data);
  const response=await fetch(baseUrl+'/api'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(method==='GET'?{}:{'Content-Type':'application/json'})},...(method==='GET'?{}:{body:JSON.stringify(data)})});return {status:response.status,...await response.json()};
}
const health=await api('/health');assert.equal(health.status,200);assert.equal(health.ok,true);
const login=await api('/access/login','POST',{code:secret.accessPassword});assert.equal(login.status,200);
const workspace=await api('/workspace?all=true','GET',undefined,login.data.accessToken);assert.equal(workspace.status,200);
assert.equal(workspace.data.parts.length,1);assert.equal(workspace.data.parts[0].teachers.length,0);assert.equal(workspace.data.global.source.deploymentTestId,undefined);
m.previewDeploymentId=preview.id;m.previewUrl=baseUrl;await saveManifest(m);
await mkdir('test-results/cloudflare',{recursive:true});await writeFile('test-results/cloudflare/isolation.json',JSON.stringify({productionUrl:m.baseUrl,previewUrl:baseUrl,productionDatabaseId:m.databaseId,previewDatabaseId:m.previewDatabaseId,separateDatabases:true,previewTeachers:0,previewDepartments:1,passed:true},null,2)+'\n');
console.log('PASS 미리보기 배포와 D1 분리 확인:',baseUrl);
