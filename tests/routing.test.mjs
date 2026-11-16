import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';

test('route dispatch preserves authentication and policy gates before unknown methods and paths',async t=>{
  const h=await createHarness();t.after(()=>h.close());
  const token=await h.login();
  for(const [path,method] of [['/missing','GET'],['/workspace','POST'],['/auth/logout','GET']]){
    assert.equal((await h.api(path,method,method==='POST'?{}:undefined)).status,401);
    const result=await h.api(path,method,method==='POST'?{}:undefined,token);
    assert.equal(result.status,404);assert.equal(result.code,'not_found');
    assert.equal(result.response.headers.get('cache-control'),'no-store');
    assert.match(result.response.headers.get('server-timing'),/^app;dur=\d+\.\d{2}, db;dur=\d+\.\d{2}$/);
  }
  const policy=await createHarness({policy:{teachers:false}});t.after(()=>policy.close());
  const policyToken=await policy.login();
  for(const path of ['/workspace','/sheets/unknown'])assert.equal((await policy.api(path,'POST',{},policyToken)).code,'course_closed');
});
