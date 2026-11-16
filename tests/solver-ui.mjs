import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {checkUi} from './ui-contract.mjs';

const label=process.argv[2]||'after',directory=`test-results/solver-ui-${label}`;
await mkdir(directory,{recursive:true});
const runs=await mkdtemp(resolve('test-results/solver-ui-runs-'));
const server=spawn(resolve('timetable-solver/runtime/python.exe'),['-u','-c','from tt_solver.server import make_server; import sys; s=make_server(0,sys.argv[1]); print(s.server_port,flush=True); s.serve_forever()',runs],{cwd:resolve('timetable-solver'),stdio:['ignore','pipe','pipe']});
let browser,stderr='';server.stderr.on('data',chunk=>stderr+=chunk);
try{
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Local solver startup timeout: '+stderr)),30000);
    server.once('error',error=>{clearTimeout(timer);reject(error);});
    server.once('exit',code=>{clearTimeout(timer);reject(Error(`Solver exited ${code}: ${stderr}`));});
    server.stdout.once('data',data=>{clearTimeout(timer);resolve(Number(data.toString().trim()));});
  });
  const url=`http://127.0.0.1:${port}`;
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
  await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/runs')),page.goto(url)]);
  if(label==='before'){
    await page.screenshot({path:`${directory}/desktop.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${directory}/mobile.png`,fullPage:true});
  }else{
    await checkUi(page,'solver',directory);
    const response=await context.request.get(url+'/shared/ui.css');assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/^text\/css/);
    assert.equal(await response.text(),await readFile('shared/ui.css','utf8'));
    for(const path of ['/shared/%2e%2e/AGENTS.md','/shared/ui.css/extra','/shared/workbook.js'])assert.equal((await context.request.get(url+path)).status(),404,path);
    assert.equal(await page.locator('#run').getAttribute('class'),'primary');
  }
  assert.deepEqual(errors,[]);console.log('PASS local solver UI '+label+' (desktop and 390px, synthetic empty runs)');
}finally{await browser?.close();server.kill();}
