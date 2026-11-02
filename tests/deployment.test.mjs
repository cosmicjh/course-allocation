import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveApiBase,GITHUB_SITE,CLOUDFLARE_API} from '../shared/deployment.js';
import {preflight} from '../server/cors.js';

test('GitHub frontend may use only the canonical Cloudflare API across origins',()=>{
  assert.equal(resolveApiBase(CLOUDFLARE_API,GITHUB_SITE),CLOUDFLARE_API);
  assert.equal(resolveApiBase('/api','http://localhost:8788/'),'http://localhost:8788/api');
  for(const base of ['https://foreign.example/api',CLOUDFLARE_API+'?redirect=foreign',CLOUDFLARE_API+'#foreign','https://user:secret@course-allocation.pages.dev/api'])assert.throws(()=>resolveApiBase(base,GITHUB_SITE));
  assert.throws(()=>resolveApiBase(CLOUDFLARE_API,'https://foreign.example/'));
});
test('CORS preflight accepts the GitHub origin and rejects unknown origins, methods and headers',()=>{
  const request=overrides=>new Request(CLOUDFLARE_API+'/sheets/d1',{method:'OPTIONS',headers:{Origin:'https://cosmicjh.github.io','Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'authorization, content-type',...overrides}});
  const accepted=preflight(request());assert.equal(accepted.status,204);assert.equal(accepted.headers.get('access-control-allow-origin'),'https://cosmicjh.github.io');assert.equal(accepted.headers.get('access-control-allow-credentials'),null);
  for(const headers of [{Origin:'https://foreign.example'},{Origin:'https://cosmicjh.github.io.foreign.example'},{'Access-Control-Request-Method':'DELETE'},{'Access-Control-Request-Headers':'x-unsafe'}]){const denied=preflight(request(headers));assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);}
});
