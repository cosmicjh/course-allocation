import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {graph,manifest,assertTestTarget} from './cloudflare-client.mjs';
const m=await manifest();assertTestTarget(m);
const trace=JSON.parse(await readFile('test-results/cloudflare/live-tail.json','utf8'));
if(trace.deploymentId!==m.deploymentId)throw new Error('현재 시험 배포의 실행 로그가 아닙니다.');
const names=[...new Set(trace.events.map(e=>e.scriptName).filter(Boolean))];if(names.length!==1)throw new Error('시험 스크립트 식별자가 한 개가 아닙니다.');
const query=`query($account:string!,$script:string!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$account}){
  pagesFunctionsInvocationsAdaptiveGroups(limit:10,filter:{scriptName:$script,datetime_geq:$start,datetime_leq:$end}){
    dimensions{scriptName status usageModel} sum{requests errors} quantiles{cpuTimeP50 cpuTimeP99}
  }
}}}`;
const result=await graph(query,{account:m.accountId,script:names[0],start:m.deployedAt,end:new Date().toISOString()});
await mkdir('test-results/cloudflare',{recursive:true});await writeFile('test-results/cloudflare/analytics.json',JSON.stringify({queriedAt:new Date().toISOString(),scriptName:names[0],result},null,2)+'\n');
console.log(JSON.stringify(result,null,2));
