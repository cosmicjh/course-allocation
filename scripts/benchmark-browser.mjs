import {chromium} from 'playwright';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import assert from 'node:assert/strict';
import {createHarness} from '../tests/harness.mjs';
import {scaleState} from '../tests/fixtures/scale.js';
import * as S from '../shared/state.js';
import {digest} from '../server/crypto.js';

const label=process.argv[2]||'current',ref=process.argv.find(x=>x.startsWith('--ref='))?.slice(6);
const iterations=Number(process.env.BENCHMARK_ITERATIONS||30);
if(!Number.isInteger(iterations)||iterations<30||iterations>100)throw Error('Use 30 to 100 iterations');
const source=async file=>{
  if(!ref)return readFile(file,'utf8');
  const result=spawnSync('git',['show',`${ref}:${file.replaceAll('\\','/')}`],{encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr);return result.stdout;
};
const instrument=code=>{
  code=code.replaceAll('C.clone(','__clone(').replaceAll('C.assertState(','__assert(');
  code=code.replace('"use strict";',`"use strict";
    const __bench=window.__ALLOCATION_BENCH={samples:[],step(name,fn){const start=performance.now();try{return fn();}finally{this.samples.push({name,ms:performance.now()-start});}}};
    const __clone=value=>__bench.step('clone',()=>C.clone(value));
    const __assert=value=>__bench.step('validate',()=>C.assertState(value));`);
  return code.replace('\nawait initialize();',`
    for(const [name,get,set] of [
      ['render',()=>render,v=>render=v],['render',()=>paintCellChanges,v=>paintCellChanges=v],
      ['render',()=>repaintSheetPanel,v=>repaintSheetPanel=v],
      ['sheetHtml',()=>sheetView,v=>sheetView=v],['frameLayout',()=>applyFrameSize,v=>applyFrameSize=v],
      ['scrollLayout',()=>alignHorizontalScroll,v=>alignHorizontalScroll=v],
      ['mutate',()=>mutate,v=>mutate=v],['mutateCell',()=>mutateCell,v=>mutateCell=v]
    ]){const original=get();set((...args)=>__bench.step(name,()=>original(...args)));}
    await initialize();`);
};
const bundle=await build({entryPoints:['app/workbook.js','app/workbook.css'],bundle:true,minify:true,format:'esm',target:'es2022',outdir:'unused',write:false,plugins:[{name:'measured-source',setup(b){
  b.onLoad({filter:/\.(js|css)$/},async args=>{const file=relative(process.cwd(),args.path).replaceAll('\\','/');let contents=await source(file);if(file==='app/workbook.js')contents=instrument(contents);return {contents,loader:file.endsWith('.css')?'css':'js',resolveDir:resolve(args.path,'..')};});
}}]});
const assets=new Map(bundle.outputFiles.map(file=>['/'+file.path.split(/[\\/]/).at(-1),Buffer.from(file.contents)]));
const html=(await source('index.html')).replace('./app/workbook.js','./workbook.js').replace('./app/workbook.css','./workbook.css');
const workerScript=ref?(await build({entryPoints:['tests/worker.mjs'],bundle:true,format:'esm',platform:'browser',write:false,plugins:[{name:'baseline-api',setup(b){b.onLoad({filter:/\.js$/},async args=>({contents:await source(relative(process.cwd(),args.path)),loader:'js',resolveDir:resolve(args.path,'..')}));}}]})).outputFiles[0].text:undefined;
const config=await source('config.js'),h=await createHarness({seed:false,workerScript}),fixture=scaleState();
let browser;
try{
  await h.db.prepare('DELETE FROM sheets').run();await h.db.prepare('UPDATE workspace SET payload=? WHERE id=1').bind(JSON.stringify(S.globalPart(fixture))).run();
  for(const d of fixture.departments){const part=S.departmentPart(fixture,d.id);await h.db.prepare('INSERT INTO sheets(id,payload,identity_hash) VALUES (?,?,?)').bind(d.id,JSON.stringify(part),await digest(S.identityKey(part))).run();}
  const url=await h.listen();
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{
    const target=new URL(route.request().url());if(target.origin!==url)return route.abort();
    if(target.pathname.startsWith('/api/'))return route.continue();
    const body=target.pathname==='/'?html:target.pathname==='/config.js'?config:assets.get(target.pathname);
    return body===undefined?route.abort():route.fulfill({body,contentType:target.pathname.endsWith('.css')?'text/css':target.pathname.endsWith('.js')?'text/javascript':'text/html'});
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('#access-form input').fill('virtual-access-2026');await page.locator('#access-form button').click();await page.locator('[data-edit=teacher-name]').first().waitFor();
  // Cache all 12 departments before measuring; each edit must preserve the other 11 drafts.
  for(let d=2;d<=12;d++){await page.locator(`[data-sheet=d${d}]`).click();await page.locator(`[data-edit=teacher-name][data-id=d${d}-t0]`).waitFor();}
  await page.locator('[data-sheet=d1]').click();
  const samples=[];
  const measure=async(action,index)=>page.evaluate(async({action,index})=>{
    const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve)),start=performance.now();window.__ALLOCATION_BENCH.samples=[];
    const edit=(selector,value)=>{const input=document.querySelector(selector);if(!input)throw Error('Missing '+selector);input.focus();input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
    if(action==='allocation')edit('[data-edit=allocation][data-teacher=d1-t0][data-section=d1-c0-g0-s]',String(index%2?3:2));
    if(action==='teacher-name')edit('[data-edit=teacher-name][data-id=d1-t0]','Synthetic '+index);
    if(action==='department-switch')document.querySelector(`[data-sheet=d${index%2?1:2}]`).click();
    if(action==='validation')document.querySelector('[data-view=validation]').click();
    if(action==='save')document.querySelector('[data-action=save-sheet]').click();
    if(action==='save')while(document.querySelector('[data-action=save-sheet]').disabled||document.querySelector('.header-save').textContent!=='저장됨'){
      if(performance.now()-start>10000)throw Error('Save timeout');await frame();
    }
    await frame();await frame();
    return {action,ms:performance.now()-start,stages:window.__ALLOCATION_BENCH.samples};
  },{action,index});
  for(const action of ['allocation','teacher-name','department-switch','validation','save']){
    await page.locator('[data-sheet=d1]').click();
    for(let i=0;i<iterations;i++){
      if(action==='validation')await page.locator('[data-view=sheet]').click();
      if(action==='save')await page.evaluate(i=>{const x=document.querySelector('[data-edit=teacher-name][data-id=d1-t0]');x.value='Save '+i;x.dispatchEvent(new Event('change',{bubbles:true}));},i);
      samples.push(await measure(action,i));
    }
    console.log('Measured '+action+' x '+iterations);
  }
  if(errors.length)throw Error(errors.join('\n'));
  for(const sample of samples.filter(s=>['allocation','teacher-name'].includes(s.action)))assert.ok(sample.stages.some(s=>s.name==='mutateCell')&&sample.stages.some(s=>s.name==='render'),'Mutation and render instrumentation must execute');
  const summarize=values=>{values.sort((a,b)=>a-b);const round=x=>Math.round(x*100)/100;return {count:values.length,p50Ms:round(values[Math.ceil(values.length*.5)-1]),p95Ms:round(values[Math.ceil(values.length*.95)-1]),maxMs:round(values.at(-1))};};
  const summary=Object.fromEntries([...new Set(samples.map(s=>s.action))].map(action=>[action,summarize(samples.filter(s=>s.action===action).map(s=>s.ms))]));
  const stages={};for(const action of ['allocation','teacher-name','department-switch','validation'])for(const name of ['clone','validate','render','mutateCell','sheetHtml','frameLayout','scrollLayout']){
    const values=samples.filter(s=>s.action===action).map(s=>s.stages.filter(t=>t.name===name).reduce((n,s)=>n+s.ms,0));stages[action+':'+name]=summarize(values);
  }
  const report={ref:ref||'working-tree',environment:'headless Edge, synthetic local Miniflare D1, all 12 departments cached; event to second animation frame; instrumentation only in benchmark bundle',fixture:{departments:12,teachers:144,courses:96,sections:576,assignments:576},iterations,summary,stages,samples};
  await mkdir('test-results',{recursive:true});await writeFile(`test-results/task-c-browser-${label}.json`,JSON.stringify(report,null,2)+'\n');console.table(summary);console.table(stages);
}finally{await browser?.close();await h.close();}
