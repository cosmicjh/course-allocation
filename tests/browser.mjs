import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHarness} from './harness.mjs';
import {createRemoteHarness} from './remote-harness.mjs';
import {hoursFixture} from './fixtures/demo.js';
import '../scripts/build.mjs';

await mkdir('test-results',{recursive:true});
const remote=process.env.ALLOCATION_REMOTE_TEST==='1';
const h=remote?await createRemoteHarness():await createHarness();let browser;
const testAccess=h.passwords?.access??'virtual-access-2026',testAdmin=h.passwords?.admin??'virtual-admin-2026';
const revision=async()=>h.remote?await h.revision('d1'):(await h.db.prepare('SELECT revision FROM sheets WHERE id=\'d1\'').first()).revision;
const steps=[],errors=[];
async function step(name,fn){const start=performance.now();await fn();steps.push({name,ms:Math.round(performance.now()-start)});console.log('PASS '+name);}
try{
  const url=await h.listen();
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  const allowedRequest=request=>new URL(request.url()).origin===url||(remote&&new URL(request.url()).origin==='https://cdn.jsdelivr.net'&&['font','stylesheet'].includes(request.resourceType()));
  await context.route('**/*',route=>allowedRequest(route.request())?route.continue():route.abort());
  const button=action=>page.locator('[data-action="'+action+'"]');
  const submit=label=>page.locator('#dialog button[type=submit]').filter({hasText:label}).click();
  const save=async()=>{const response=page.waitForResponse(r=>r.url().includes('/api/sheets/')&&r.request().method()==='PUT');await button('save-sheet').click();assert.equal((await response).status(),200);await page.waitForFunction(()=>document.querySelector('.header-save')?.textContent==='저장됨');};
  const login=async target=>{await target.goto(url);await target.locator('#access-form input').fill(testAccess);await target.locator('#access-form button').click();await target.locator('[data-edit=teacher-name]').first().waitFor();};
  await step('접속 및 기존 배당표 표시',async()=>{await login(page);await page.screenshot({path:'test-results/01-workbook.png',fullPage:true});assert.equal(await page.locator('.plan-table').count(),1);assert.equal(await page.locator('.teacher-table').count(),1);});
  const otherContext=await browser.newContext(),other=await otherContext.newPage();
  await otherContext.route('**/*',route=>allowedRequest(route.request())?route.continue():route.abort());await login(other);
  await step('교사 편집·저장 및 충돌 시 로컬 입력 보존',async()=>{
    await page.locator('[data-edit=teacher-name]').first().fill('가상브라우저교사');await page.locator('[data-edit=teacher-name]').first().press('Tab');await save();
    await other.locator('[data-edit=teacher-name]').first().fill('가상충돌보존');await other.locator('[data-edit=teacher-name]').first().press('Tab');
    const pending=other.waitForResponse(r=>r.url().includes('/api/sheets/'));await other.locator('[data-action=save-sheet]').click();assert.equal((await pending).status(),409);assert.equal(await other.locator('[data-edit=teacher-name]').first().inputValue(),'가상충돌보존');
    await otherContext.close();
  });
  await step('교과군 전환 및 저장본 재조회',async()=>{await page.locator('[data-sheet=d2]').click();await page.locator('[data-edit=teacher-name][data-id=teacher-d2]').waitFor();await page.locator('[data-sheet=d1]').click();assert.equal(await page.locator('[data-edit=teacher-name]').first().inputValue(),'가상브라우저교사');await page.reload();await page.locator('[data-edit=teacher-name]').first().waitFor();assert.equal(await page.locator('[data-edit=teacher-name]').first().inputValue(),'가상브라우저교사');});
  await step('저장 응답 유실 후 같은 작업 ID로 안전하게 재시도',async()=>{
    const before=await revision();
    let firstId;let finish;const failed=new Promise(resolve=>finish=resolve);
    await page.route('**/api/sheets/d1',async route=>{firstId=route.request().postDataJSON().operationId;const response=await route.fetch();assert.equal(response.status(),200);await route.abort();finish();});
    await page.locator('[data-edit=teacher-name]').first().fill('가상재시도교사');await page.locator('[data-edit=teacher-name]').first().press('Tab');await button('save-sheet').click();await failed;
    await page.waitForFunction(()=>!document.querySelector('[data-action=save-sheet]').disabled);await page.unroute('**/api/sheets/d1');
    const request=page.waitForRequest(r=>r.url().includes('/api/sheets/d1'));await save();assert.equal((await request).postDataJSON().operationId,firstId);
    assert.equal(await revision(),before+1);
  });
  await step('관리자 로그인·제출·확정·입력 재개',async()=>{
    await button('mode-admin').click();await page.locator('#dialog [name=password]').fill(testAdmin);await submit('진입');await page.locator('[data-view=settings]').waitFor();
    await page.locator('[data-view=validation]').click();await button('submit').click();await submit('제출');await save();await button('approve').click();await save();await button('reopen').click();await save();await page.locator('[data-view=sheet]').click();
  });
  await step('분반배정 JSON 가져오기·미리보기·저장',async()=>{
    await page.locator('#hours-import-file').setInputFiles({name:'virtual-course-hours.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(hoursFixture()))});
    await page.locator('#dialog [name=dept-0-0]').fill('가상국어');await submit('미리보기');await submit('확인 후 적용');await save();assert.ok((await page.locator('.plan-table tbody').innerText()).includes('가상추가 과목'));
  });
  let backup;
  await step('JSON 백업 및 CSV 다운로드',async()=>{
    let event=page.waitForEvent('download');await button('backup').click();let download=await event;backup=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(backup.schemaVersion,1);assert.equal(backup.departments.length,2);
    event=page.waitForEvent('download');await button('csv').click();download=await event;assert.match(await readFile(await download.path(),'utf8'),/가상재시도교사/);
  });
  await step('JSON 백업 복원',async()=>{
    backup.teachers.find(t=>t.id==='teacher-d1').name='가상복원교사';await page.locator('#backup-file').setInputFiles({name:'virtual-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await submit('확인');await save();assert.equal(await page.locator('[data-edit=teacher-name]').first().inputValue(),'가상복원교사');
  });
  await step('현재 입력 내용·빈 양식 인쇄 SVG',async()=>{
    await page.evaluate(()=>{window.__virtualPrintCount=0;window.print=()=>{window.__virtualPrintCount++;};});
    await button('print-current').click();await page.waitForFunction(()=>window.__virtualPrintCount===1);assert.equal(await page.locator('#print-root svg').count(),1);await writeFile('test-results/current-print.svg',await page.locator('#print-root').innerHTML());
    await button('print-form').click();await page.waitForFunction(()=>window.__virtualPrintCount===2);assert.equal(await page.locator('#print-root svg').count(),1);
  });
  await step('교과군 생성·학교 설정·성능 측정',async()=>{
    await button('new-dept').click();await page.locator('#dialog [name=name]').fill('가상시험교과');await submit('시트 추가');await button('save-sheet').click();await page.waitForFunction(()=>document.querySelector('.header-save')?.textContent==='저장됨');
    await page.locator('[data-view=settings]').click();await page.locator('#school-form [name=name]').fill('가상시험학교');await page.locator('#school-form button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('.header-save')?.textContent==='저장됨');
    await button('performance').click();assert.match(await page.locator('#dialog').innerText(),/클라이언트/);await page.locator('[data-perf=close]').click();
    await page.screenshot({path:'test-results/02-settings.png',fullPage:true});
  });
  const performanceReport=await page.evaluate(()=>window.ALLOCATION_PERFORMANCE.snapshot());
  assert.ok(performanceReport.samples.some(s=>s.action==='load'));assert.ok(performanceReport.samples.some(s=>s.action==='save'));assert.deepEqual(errors,[]);
  assert.doesNotMatch(JSON.stringify(performanceReport),/virtual-access-2026|virtual-admin-2026|가상복원교사|Bearer/);
  assert.equal(JSON.stringify(performanceReport).includes(testAccess),false);assert.equal(JSON.stringify(performanceReport).includes(testAdmin),false);
  const report={environment:remote?'Cloudflare Pages + remote D1 + headless Edge; synthetic data only':'local Miniflare + headless Chromium; synthetic data only',...(remote?{baseUrl:url,deploymentId:h.m.deploymentId}:{}),steps,errors,performance:performanceReport};
  await writeFile('test-results/browser.json',JSON.stringify(report,null,2)+'\n');if(remote)await h.writeReport('browser.json',report);
  console.log(`브라우저 시험 ${steps.length}개 통과`);
}finally{await browser?.close();await h.close();}
