// Same isolated routing and synthetic database as browser.mjs; never contacts production.
import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHarness} from './harness.mjs';
import {GITHUB_SITE,GITHUB_ORIGIN,CLOUDFLARE_API} from '../shared/deployment.js';
import '../scripts/build-github.mjs';

const label=process.argv[2]||'current',directory=`test-results/ui-${label}`;
await mkdir(directory,{recursive:true});
const h=await createHarness(),browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{})});
const report={environment:'headless Edge, cold contexts, external fonts blocked, synthetic local D1; response body bytes (no compression)',configurations:[]};
try{
  const local=await h.listen();
  for(const github of [false,true]){
    const runs=[];
    for(let run=0;run<3;run++){
      const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),responses=[];
      await context.route('**/*',async route=>{
        const target=new URL(route.request().url());
        if(!github)return target.origin===local?route.continue():route.abort();
        if(target.origin===new URL(CLOUDFLARE_API).origin&&target.pathname.startsWith('/api/'))return route.fulfill({response:await route.fetch({url:local+target.pathname+target.search,headers:{...route.request().headers(),origin:GITHUB_ORIGIN}})});
        if(target.origin===GITHUB_ORIGIN&&target.pathname.startsWith('/course-allocation/')){
          const root=resolve('dist-github'),file=resolve(root,decodeURIComponent(target.pathname.slice('/course-allocation/'.length))||'index.html');
          if(!file.startsWith(root+sep))return route.abort();
          return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html',body:await readFile(file)});
        }
        return route.abort();
      });
      page.on('response',response=>{if(['document','script','stylesheet'].includes(response.request().resourceType())&&response.ok())responses.push(response);});
      await page.goto(github?GITHUB_SITE:local);
      await page.locator('#access-form').waitFor();
      const resources=await Promise.all(responses.map(async response=>({type:response.request().resourceType(),path:new URL(response.url()).pathname,bytes:(await response.body()).length})));
      const navigation=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return {domContentLoadedMs:n.domContentLoadedEventEnd-n.startTime};});
      runs.push({...navigation,jsCssRequests:resources.filter(r=>r.type!=='document').length,jsCssBytes:resources.filter(r=>r.type!=='document').reduce((n,r)=>n+r.bytes,0),totalDocumentJsCssBytes:resources.reduce((n,r)=>n+r.bytes,0),resources});
      if(run===0){
        await page.locator('#access-form input').fill('virtual-access-2026');await page.locator('#access-form button').click();await page.locator('[data-edit=teacher-name]').first().waitFor();
        await page.screenshot({path:`${directory}/${github?'github':'local'}-desktop.png`,fullPage:true});
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${directory}/${github?'github':'local'}-mobile.png`,fullPage:true});
      }
      await context.close();
    }
    report.configurations.push({configuration:github?'github-subpath':'local',runs,medianDclMs:runs.map(r=>r.domContentLoadedMs).sort((a,b)=>a-b)[1]});
  }
  await writeFile(`${directory}/load.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.configurations.map(({configuration,runs,medianDclMs})=>({configuration,...runs[0],resources:undefined,medianDclMs})),null,2));
}finally{await browser.close();await h.close();}
