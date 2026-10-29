import {Miniflare,Log,LogLevel} from 'miniflare';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {provisionCredential,randomToken} from '../server/crypto.js';
import {preparePasswordRequest} from '../shared/password.js';
import {demoSeed} from './fixtures/demo.js';

let bundle,hashes;
export async function createHarness({seed=true}={}){
  const trace=message=>{if(process.env.DEBUG_HARNESS)console.log('harness:',message);};
  trace('bundle');
  bundle??=(await build({entryPoints:['tests/worker.mjs'],bundle:true,format:'esm',platform:'browser',write:false})).outputFiles[0].text;
  if(!hashes){const pepper=randomToken();hashes={PASSWORD_PEPPER:pepper,BOOTSTRAP_ACCESS_HASH:await provisionCredential('virtual-access-2026',pepper,'access'),BOOTSTRAP_ADMIN_HASH:await provisionCredential('virtual-admin-2026',pepper,'admin')};}
  trace('runtime');
  const mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-07-30',d1Databases:{DB:'virtual-'+crypto.randomUUID()},bindings:hashes,host:'127.0.0.1',port:0,log:new Log(LogLevel.ERROR)});
  // Use asynchronous HTTP fixture calls instead of Miniflare's synchronous Node proxy.
  // That proxy can block indefinitely under Windows/Node worker-thread launch flags.
  const db={prepare(sql){let args=[];const query={bind(...values){args=values;return query;},async all(){const r=await mf.dispatchFetch('http://localhost/__virtual_fixture_sql',{method:'POST',body:JSON.stringify({sql,args})});if(!r.ok)throw new Error(await r.text());return r.json();},async run(){return query.all();},async first(){return (await query.all()).results[0]??null;}};return query;}};
  trace('schema');
  try {
  const sql=await readFile('migrations/0001_init.sql','utf8');
  const statements=sql.replace(/^--.*$/gm,'').split(/;\s*(?=CREATE (?:TABLE|INDEX|VIEW|TRIGGER)|INSERT INTO (?:workspace|sheets))/).map(x=>x.trim()).filter(Boolean);
  for(const statement of statements)await db.prepare(statement).run();
  trace('seed');
  if(seed)for(const statement of demoSeed().trim().split(/;\s*/).filter(Boolean))await db.prepare(statement).run();
  } catch(error) { await mf.dispose();throw error; }
  let count=0,server;
  async function api(path,method='GET',data,token,extraHeaders={}){
    data=await preparePasswordRequest(path,data,async p=>{const r=await api(p,'GET',undefined,token,extraHeaders);if(!r.ok)throw new Error(JSON.stringify(r));return r.data;});
    const response=await mf.dispatchFetch('http://localhost/api'+path,{method,headers:{'CF-Connecting-IP':'virtual-test-'+(++count),...(token?{Authorization:'Bearer '+token}:{}),...(method!=='GET'?{'Content-Type':'application/json'}:{}),...extraHeaders},...(method!=='GET'?{body:JSON.stringify(data??{})}:{})});
    return {response,status:response.status,...await response.json()};
  }
  async function login(admin=false){
    const access=await api('/access/login','POST',{code:'virtual-access-2026',includeState:true});
    if(!access.ok)throw Error(JSON.stringify(access));
    if(!admin)return access.data.accessToken;
    const result=await api('/auth/login','POST',{password:'virtual-admin-2026'},access.data.accessToken);
    if(!result.ok)throw Error(JSON.stringify(result));return result.data.adminToken;
  }
  return {mf,db,api,login,
    async listen(){
      const root=resolve('dist'),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json'};
      server=createServer(async(req,res)=>{
        try{
          const url=new URL(req.url,'http://'+req.headers.host);
          if(url.pathname.startsWith('/api/')){
            const chunks=[];for await(const chunk of req)chunks.push(chunk);
            const response=await mf.dispatchFetch(url.href,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
            res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
          }
          const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
          if(!file.startsWith(root+sep))throw Error('path');
          const contents=await readFile(file);res.writeHead(200,{'Content-Type':mime['.'+file.split('.').pop()]||'application/octet-stream'});res.end(contents);
        }catch{res.writeHead(404);res.end('Not found');}
      });
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;
    },
    async close(){if(server)await new Promise(resolve=>server.close(resolve));await mf.dispose();}
  };
}
