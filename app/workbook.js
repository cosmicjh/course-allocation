import * as C from '../shared/domain.js';
import * as S from '../shared/state.js';
import * as R from '../shared/catalog.js';
import * as P from '../shared/print.js';
import * as H from '../shared/hours-import.js';
import * as Reset from '../shared/reset.js';
import {createTransport} from '../shared/transport.js';
import {metrics,showPerformance} from '../shared/performance.js';

(async()=>{
"use strict";

// Import school-course-hours v1. Only workload and cohort references are retained.


const defaultNameHashes={};


const apiTransport=createTransport({onExpired(){if(cloud.ready){cloud.admin=false;ui.mode="input";ui.view="sheet";}}});


const app=document.querySelector('#app'),dialog=document.querySelector('#dialog');
let state,toastTimer;
const cloud={ready:false,admin:false,saving:false,globalRevision:0,revisions:{},base:{},globalBase:null,dirty:new Set(),globalDirty:false,context:null,loaded:new Set(),scoped:true,loading:false,fullLoading:false,loadTicket:0};
const FRAME_KEY='course-allocation-frame-ratio';
let frameRatio=null,frameDrag=null;
try{const saved=localStorage.getItem(FRAME_KEY);if(saved!==null&&Number.isFinite(Number(saved))&&Number(saved)>0&&Number(saved)<100)frameRatio=Number(saved);}catch{}
const ui={mode:'input',view:'sheet',deptId:'d1',catalogGroup:'korean',grade:2,newCourse:'',printing:false};
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h4v15h-4a4 4 0 0 0-3 2',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M20 8v6m-3-3h6',settings:'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',check:'m5 12 4 4L19 6',alert:'m12 3 10 18H2zM12 9v5M12 17h.01',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',upload:'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',plus:'M12 5v14M5 12h14',info:'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',save:'M4 3h13l4 4v14H3V3zM7 3v7h10V3M7 21v-7h10v7',close:'m6 6 12 12M6 18 18 6',trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'};
const icon=n=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n]||paths.grid}"/></svg>`;
const btn=(a,l,i='',cl='',attrs='')=>`<button type="button" data-action="${a}" class="${cl}" ${attrs}>${l||(i==='close'?'닫기':'')}</button>`;
const badge=(t,cl='')=>`<span class="pill ${cl}">${e(t)}</span>`;
const dept=()=>state.departments.find(d=>d.id===ui.deptId)??state.departments[0];
const draft=()=>dept().status==='draft';
const statusText={draft:'입력 중',submitted:'제출 완료',locked:'관리자 확정'};
const groupOptions=(sel,all=false)=>`${all?'<option value="all">전체 교과(군)</option>':''}${R.groups.map(g=>`<option value="${g.id}" ${g.id===sel?'selected':''}>${e(g.name)}</option>`).join('')}`;
const items=()=>[...R.catalog,...(state.customCatalog??[])];
const heading=(t,s,b='')=>`<div class="page-heading"><div><h1>${t}</h1></div><div class="actions">${b}</div></div>`;
const columns=()=>state.school.grades.flatMap(g=>[...Array.from({length:g.classCount},(_,i)=>({grade:g.grade,label:`${g.grade}-${i+1}`,caption:String(i+1),kind:'homeroom'})),...Array.from({length:g.movingCount},(_,i)=>({grade:g.grade,label:`${g.grade}${C.letter(i+1)}`,caption:`${g.grade}${C.letter(i+1)}`,kind:'moving'}))]);
function toast(t,error=false){const x=document.querySelector('#toast');x.textContent=t;x.className=`show ${error?'error':''}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>x.className='',error?6000:3000);}

function mutate(label,fn){if(!cloud.ready||cloud.saving||cloud.loading){toast('연결 또는 저장을 확인하세요.',true);return false;}try{const next=C.clone(state);fn(next);S.invalidateParts(next);C.assertState(next);next.history.unshift({at:new Date().toISOString(),action:label});next.history=next.history.slice(0,200);state=next;for(const d of state.departments)if(!cloud.globalBase.departmentIds.includes(d.id))cloud.loaded.add(d.id);markDirty();render();return true;}catch(err){toast(err.message,true);return false;}}
function route(v){if(v==='settings'&&!cloud.admin){loginDialog();return;}ui.view=v;render();}

var GridUi=(function(){
function canAllocate(state,teacherId,group){
  if(!group)return false;
  if(group.legacy.length)return group.legacy.some(a=>a.teacherId===teacherId&&a.hours>0);
  return group.slots.some(slot=>state.assignments.some(a=>a.teacherId===teacherId&&a.sectionId===slot.id&&a.hours>0)||C.allocated(state,slot.id)<slot.hours);
}
function padding(planMax,teacherMax){
  const p=Math.max(0,Number(planMax)||0),t=Math.max(0,Number(teacherMax)||0);
  return {plan:Math.max(0,t-p),teacher:Math.max(0,p-t)};
}
return {canAllocate,padding};
})();

let horizontalObserver=null,horizontalFrame=0;
function syncPlanScroll(){
  const plan=document.querySelector('.plan-scroll'),teacher=document.querySelector('.sheet-scroll');if(!plan||!teacher)return;
  if(Math.abs(plan.scrollLeft-teacher.scrollLeft)>.1)plan.scrollLeft=teacher.scrollLeft;
}
function alignHorizontalScroll(left){
  const plan=document.querySelector('.plan-scroll'),teacher=document.querySelector('.sheet-scroll');if(!plan||!teacher)return;
  const target=Number.isFinite(left)?left:Number(teacher.scrollLeft)||0;
  if(![plan.scrollWidth,plan.clientWidth,teacher.scrollWidth,teacher.clientWidth].every(Number.isFinite)||plan.clientWidth<=0||teacher.clientWidth<=0){syncPlanScroll();return;}
  plan.style.paddingRight='0px';teacher.style.paddingRight='0px';
  const pad=GridUi.padding(plan.scrollWidth-plan.clientWidth,teacher.scrollWidth-teacher.clientWidth);
  plan.style.paddingRight=pad.plan+'px';teacher.style.paddingRight=pad.teacher+'px';
  const max=Math.max(0,teacher.scrollWidth-teacher.clientWidth);teacher.scrollLeft=Math.max(0,Math.min(target,max));syncPlanScroll();
}
function scheduleHorizontalAlignment(){
  if(horizontalFrame)return;
  if(typeof requestAnimationFrame!=='function'){alignHorizontalScroll();return;}
  horizontalFrame=requestAnimationFrame(()=>{horizontalFrame=0;alignHorizontalScroll();});
}
function observeHorizontalFrames(){
  if(typeof ResizeObserver==='undefined')return;
  if(!horizontalObserver)horizontalObserver=new ResizeObserver(scheduleHorizontalAlignment);
  horizontalObserver.disconnect();
  for(const selector of ['.plan-scroll','.sheet-scroll']){const frame=document.querySelector(selector);if(frame)horizontalObserver.observe(frame);}
}
function handleSheetScroll(event){
  const source=event.target,area=source.dataset?.scroll;if(!['plan','teachers'].includes(area))return;
  const plan=document.querySelector('.plan-scroll'),teacher=document.querySelector('.sheet-scroll');if(!plan||!teacher)return;
  if(area==='plan'&&document.activeElement?.closest?.('.plan-scroll')&&Math.abs(teacher.scrollLeft-plan.scrollLeft)>.1)teacher.scrollLeft=plan.scrollLeft;
  syncPlanScroll();
}
document.addEventListener('scroll',handleSheetScroll,true);
document.fonts?.ready?.then?.(scheduleHorizontalAlignment);
document.fonts?.addEventListener?.('loadingdone',scheduleHorizontalAlignment);

function render(){
  if(renderPause){paintPending=true;return;}paintPending=false;pendingCellPaint=[];panelPaintPending=false;
  if(rowOrderGesture||rowOrderKeyboard)cancelRowOrder();
  ui.deptId=dept().id;
  const old=document.querySelector('.sheet-scroll'),oldPlan=document.querySelector('.plan-scroll'),scroll=old?{left:old.scrollLeft,top:old.scrollTop,planTop:oldPlan?.scrollTop??0}:null;
  const dock=document.querySelector('.sheet-tabs'),dockLeft=dock?.scrollLeft??0,admin=ui.mode==='admin';
  const nav=[['sheet','배당표'],...(admin?[['settings','학교 설정']]:[]),['validation','검증']];
  app.innerHTML=`<div class="workbook">
    <header class="workbook-header">
      <div class="workbook-brand"><strong>교과 시수배당</strong><span>${state.school.year}학년도 ${state.school.semester}학기</span></div>
      <div class="header-actions"><span class="header-save">${cloud.loading?'자료 조회 중':cloud.dirty.has(dept().id)||cloud.globalDirty?'저장 전':'저장됨'}</span>${btn('save-sheet',e(dept().name)+' 저장','','primary',`data-id="${dept().id}" ${cloud.saving||cloud.loading?'disabled':''}`)}</div>
    </header>
    <div class="workbook-nav"><nav aria-label="작업 메뉴">${nav.map(([v,n])=>`<button data-view="${v}" class="${ui.view===v?'active':''}" ${ui.view===v?'aria-current="page"':''}>${n}</button>`).join('')}</nav><div class="file-actions">${admin?`${btn('hours-import','분반배정 가져오기','upload','small',cloud.saving||cloud.loading?'disabled':'')}${btn('refresh','불러오기','','small')}${btn('backup','백업','download','small')}${btn('restore','복원','upload','small')}${btn('csv','CSV','download','small')}${btn('timetable-transfer','시간표용 JSON','download','small')}${apiTransport.linked?btn('timetable-sync','통합시간표로 전달','','small'):''}${btn('reset-data','초기화','','small',cloud.saving||cloud.loading||ui.printing?'disabled':'')}`:''}${btn('print-form','양식 인쇄','','small',ui.printing||cloud.saving||cloud.loading?'disabled':'')}${btn('print-current','입력 내용 인쇄','','small',ui.printing||cloud.saving||cloud.loading?'disabled':'')}</div></div>
    ${ui.mode==='admin'&&ui.importedDeptIds?.some(id=>cloud.dirty.has(id))?`<p class="hours-import-pending" data-pending="import">분반배정 가져오기 적용됨 · 저장할 교과군: ${ui.importedDeptIds.filter(id=>cloud.dirty.has(id)).map(id=>e(state.departments.find(d=>d.id===id)?.name)).join(' · ')}</p>`:''}
    ${ui.mode==='admin'&&ui.resetDeptIds?.some(id=>cloud.dirty.has(id))?`<p class="hours-import-pending" data-pending="reset">초기화 적용됨 · 저장할 교과군: ${ui.resetDeptIds.filter(id=>cloud.dirty.has(id)).map(id=>e(state.departments.find(d=>d.id===id)?.name)).join(' · ')}</p>`:''}
    ${!draft()?`<div class="notice neutral">${e(dept().name)} · ${statusText[dept().status]}</div>`:''}
    <main id="main" class="${ui.view==='sheet'?'sheet-main':'page-main'}">${({sheet:sheetView,settings:settingsView,validation:validationView}[ui.view]??sheetView)()}</main>
    <footer class="sheet-dock"><div class="sheet-tabs" role="tablist" aria-label="교과군">${state.departments.map(d=>`<button type="button" role="tab" aria-selected="${d.id===dept().id}" data-sheet="${d.id}" class="sheet-tab ${d.id===dept().id?'active':''}">${e(d.name)}<i class="unsaved-dot" ${cloud.dirty.has(d.id)?'':'hidden'}></i></button>`).join('')}${admin?btn('new-dept','+','','sheet-add','aria-label="교과군 추가"'):''}</div>${apiTransport.linked?'':btn('mode-admin','관리자','','admin-entry',`aria-pressed="${admin}" title="${admin?'관리자 종료':'관리자 로그인'}"`)}</footer>
  </div>`;
  applyFrameSize();alignHorizontalScroll(scroll?.left);observeHorizontalFrames();const next=document.querySelector('.sheet-scroll');if(scroll&&next){next.scrollLeft=scroll.left;next.scrollTop=scroll.top;const plan=document.querySelector('.plan-scroll');if(plan){plan.scrollLeft=scroll.left;plan.scrollTop=scroll.planTop;}}const tabs=document.querySelector('.sheet-tabs');if(tabs)tabs.scrollLeft=dockLeft;applyHighlight();
}
let catalogCache=null;
const expandedCatalogs=new WeakSet();
function catalogIndex(){
  if(catalogCache&&catalogCache.custom===state.customCatalog)return catalogCache;
  const all=items(),byId=new Map(all.map(x=>[x.id,x])),byName=new Map();
  for(const x of all){const name=R.normalize(x.name);if(!byName.has(name))byName.set(name,x);}
  const groups=R.groups.map(g=>({name:g.name,items:R.catalog.filter(x=>x.groupId===g.id)}));
  catalogCache={custom:state.customCatalog,byId,byName,groups};return catalogCache;
}
function courseOptions(current,selected='',expanded=false){
  const index=catalogIndex(),match=current?index.byName.get(R.normalize(current.name)):null;
  const value=match?.id||(index.byId.has(selected)?selected:'');
  if(!expanded){
    if(current&&!match)return `<option value="" selected>${e(current.name)}</option>`;
    return value?`<option value="${e(value)}" selected>${e(index.byId.get(value).name)}</option>`:'<option value="" selected disabled>과목 선택</option>';
  }
  const first=current&&!match?`<option value="" selected>${e(current.name)}</option>`:`<option value="" ${!value?'selected':''} disabled>과목 선택</option>`;
  return first+index.groups.map(g=>`<optgroup label="${e(g.name)}">${g.items.map(x=>`<option value="${e(x.id)}" ${x.id===value?'selected':''}>${e(x.name)}</option>`).join('')}</optgroup>`).join('')+((state.customCatalog??[]).length?`<optgroup label="학교 추가">${state.customCatalog.map(x=>`<option value="${e(x.id)}" ${x.id===value?'selected':''}>${e(x.name)}</option>`).join('')}</optgroup>`:'');
}
function isCatalogPicker(node){return node?.tagName==='SELECT'&&(node.dataset.edit==='course-name'||node.dataset.control==='new-course');}
function expandCatalog(node){
  if(!isCatalogPicker(node)||expandedCatalogs.has(node)||node.disabled||!cloud.admin||cloud.saving||cloud.loading)return;
  const current=node.dataset.edit==='course-name'?state.courses.find(c=>c.id===node.dataset.id):null;
  if(node.dataset.edit==='course-name'&&!current)return;
  const selected=current?'':node.value||ui.newCourse;
  node.innerHTML=courseOptions(current,selected,true);expandedCatalogs.add(node);
}
function collapseCatalog(node){
  if(!isCatalogPicker(node)||!expandedCatalogs.has(node))return;
  const current=node.dataset.edit==='course-name'?state.courses.find(c=>c.id===node.dataset.id):null;
  node.innerHTML=courseOptions(current,current?'':ui.newCourse);expandedCatalogs.delete(node);
}

// Reorder whole course records or teacher blocks within the current department.
var Order=(function(){
function key(kind){if(!['course','teacher'].includes(kind))throw new Error('이동할 행을 확인하세요.');return kind==='course'?'courses':'teachers';}
function move(state,kind,deptId,id,targetId,after=false){
  const field=key(kind);C.assertDraft(state,deptId);
  const rows=state[field].filter(row=>row.deptId===deptId),source=rows.find(row=>row.id===id),target=rows.find(row=>row.id===targetId);
  if(!source||!target)throw new Error('현재 교과군 안에서 순서를 변경하세요.');
  if(id===targetId)return false;
  const ordered=rows.filter(row=>row.id!==id),index=ordered.findIndex(row=>row.id===targetId)+(after?1:0);ordered.splice(index,0,source);
  if(ordered.every((row,i)=>row.id===rows[i].id))return false;
  let next=0;state[field]=state[field].map(row=>row.deptId===deptId?ordered[next++]:row);return true;
}
function drop(items,id,y){
  const source=items.find(item=>item.id===id);if(!source||!Number.isFinite(y))return null;
  if(y>=source.top&&y<=source.bottom)return null;
  const others=items.filter(item=>item.id!==id);if(!others.length)return null;
  const before=others.find(item=>y<(item.top+item.bottom)/2),target=before||others[others.length-1];
  return {targetId:target.id,after:!before,lineY:before?target.top:target.bottom};
}
return {key,move,drop};
})();

let rowOrderGesture=null,rowOrderKeyboard=null,rowOrderAnimation=0;
function assertRowOrder(kind){
  Order.key(kind);
  if(!cloud.ready||cloud.saving||cloud.loading||ui.printing||ui.view!=='sheet')throw new Error('배당표 연결 또는 저장 상태를 확인하세요.');
  if(kind==='course'&&(!cloud.admin||ui.mode!=='admin'))throw new Error('개설 과목 순서는 관리자만 변경할 수 있습니다.');
  C.assertDraft(state,dept().id);
}
function rowOrderHandle(kind,id,label,enabled){
  return `<button type="button" class="row-drag-handle" data-row-drag="${kind}" data-id="${id}" aria-label="${e(label)} 순서 드래그" aria-describedby="row-order-help" aria-pressed="false" title="드래그하여 순서 변경 · 키보드: Space, 방향키, Enter" ${enabled?'':'disabled'}><svg viewBox="0 0 12 16" width="12" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="9" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="9" cy="13" r="1.2"/></g></svg></button>`;
}
function rowOrderSelector(kind,id){return `[data-row-drag="${kind}"][data-id="${id}"]`;}
function reorderRows(kind,id,targetId,after=false,scroll=false){
  assertRowOrder(kind);
  const trial=C.clone(state);if(!Order.move(trial,kind,dept().id,id,targetId,after))return false;
  cloud.context=null;
  const changed=mutate(kind==='course'?'개설 과목 순서 변경':'교사 순서 변경',s=>Order.move(s,kind,dept().id,id,targetId,after));
  if(changed){focusCell(rowOrderSelector(kind,id),{select:false,scroll});const rows=state[Order.key(kind)].filter(r=>r.deptId===dept().id);announceRowOrder(`${kind==='course'?'과목':'교사'} 순서를 ${rows.findIndex(r=>r.id===id)+1}번째로 변경했습니다. 교과군별 저장 버튼을 눌러 주세요.`);}
  return changed;
}
function announceRowOrder(message){const live=document.querySelector('#row-order-status');if(live)live.textContent=message;}
function rowOrderGeometry(kind){
  const frame=document.querySelector(kind==='course'?'.plan-scroll':'.sheet-scroll');if(!frame)return null;
  const bounds=frame.getBoundingClientRect(),head=frame.querySelector('thead')?.getBoundingClientRect(),headers=[...frame.querySelectorAll('thead th')];
  const top=Math.min(bounds.bottom,Math.max(bounds.top,...(headers.length?headers.map(cell=>cell.getBoundingClientRect().bottom):[head?.bottom||bounds.top]))),map=new Map();
  const selector=kind==='course'?'tr.plan-row[data-course]':'tr.teacher-row[data-teacher]';
  for(const row of frame.querySelectorAll(selector)){
    const id=kind==='course'?row.dataset.course:row.dataset.teacher,rect=row.getBoundingClientRect();
    const item=map.get(id);if(item){item.top=Math.min(item.top,rect.top);item.bottom=Math.max(item.bottom,rect.bottom);item.rows.push(row);}else map.set(id,{id,top:rect.top,bottom:rect.bottom,rows:[row]});
  }
  return {frame,bounds,top,items:[...map.values()]};
}
function clearRowOrderVisuals(){
  document.querySelectorAll('.row-order-source').forEach(row=>row.classList.remove('row-order-source'));
  document.querySelectorAll('[data-row-drag][aria-pressed="true"]').forEach(handle=>handle.setAttribute('aria-pressed','false'));
  const ghost=document.querySelector('#row-drag-ghost'),line=document.querySelector('#row-drop-line');if(ghost)ghost.hidden=true;if(line)line.hidden=true;
  document.body?.classList.remove('row-order-dragging');
}
function cancelRowOrder(message=''){
  const gesture=rowOrderGesture;rowOrderGesture=null;rowOrderKeyboard=null;
  if(rowOrderAnimation){cancelAnimationFrame(rowOrderAnimation);rowOrderAnimation=0;}
  if(gesture){try{gesture.handle.releasePointerCapture?.(gesture.pointerId);}catch{}}
  clearRowOrderVisuals();if(message)announceRowOrder(message);
}
function markRowOrderSource(kind,id){
  const geometry=rowOrderGeometry(kind);for(const item of geometry?.items||[])if(item.id===id)item.rows.forEach(row=>row.classList.add('row-order-source'));
  document.querySelector(rowOrderSelector(kind,id))?.setAttribute('aria-pressed','true');
}
function paintRowOrderLine(geometry,drop){
  const line=document.querySelector('#row-drop-line');if(!line)return;
  if(!drop||drop.lineY<geometry.top||drop.lineY>geometry.bounds.bottom){line.hidden=true;return;}
  Object.assign(line.style,{left:geometry.bounds.left+'px',top:Math.min(geometry.bounds.bottom-2,Math.max(geometry.top,drop.lineY))+'px',width:geometry.bounds.width+'px'});line.hidden=false;
}
function updateRowOrderDrop(){
  const drag=rowOrderGesture;if(!drag?.active)return;
  const geometry=rowOrderGeometry(drag.kind);if(!geometry){drag.drop=null;return;}
  const {bounds,top}=geometry,inside=drag.x>=bounds.left&&drag.x<=bounds.right&&drag.y>=top&&drag.y<=bounds.bottom;
  drag.drop=inside?Order.drop(geometry.items,drag.id,drag.y):null;
  paintRowOrderLine(geometry,drag.drop);
  const ghost=document.querySelector('#row-drag-ghost');if(ghost){ghost.textContent=drag.label;Object.assign(ghost.style,{left:Math.max(8,Math.min(drag.x+16,window.innerWidth-230))+'px',top:Math.max(8,Math.min(drag.y+14,window.innerHeight-50))+'px'});ghost.hidden=false;}
}
function rowOrderTick(){
  rowOrderAnimation=0;const drag=rowOrderGesture;if(!drag?.active)return;
  const geometry=rowOrderGeometry(drag.kind);
  if(geometry){
    const {bounds,frame,top}=geometry;
    if(drag.x>=bounds.left&&drag.x<=bounds.right&&drag.y>=top-24&&drag.y<=bounds.bottom+24){
      const edge=Math.min(44,Math.max(14,(bounds.bottom-top)/4)),distance=drag.y<top+edge?drag.y-top-edge:drag.y>bounds.bottom-edge?drag.y-bounds.bottom+edge:0;
      if(distance)frame.scrollTop+=Math.sign(distance)*Math.min(18,Math.max(2,Math.abs(distance)*0.4));
    }
  }
  updateRowOrderDrop();rowOrderAnimation=requestAnimationFrame(rowOrderTick);
}
function beginRowOrder(event){
  const handle=event.target.closest?.('[data-row-drag]');if(!handle?.dataset.rowDrag||handle.disabled||event.button!==0||event.isPrimary===false||frameDrag||dialog.open)return;
  try{
    cancelRowOrder();const kind=handle.dataset.rowDrag,id=handle.dataset.id;assertRowOrder(kind);
    const active=document.activeElement;if(active?.dataset?.edit&&!commitField(active)){event.preventDefault();return;}
    flushInputPaint();const current=document.querySelector(rowOrderSelector(kind,id));if(!current||current.disabled)return;
    const rows=state[Order.key(kind)].filter(r=>r.deptId===dept().id),item=rows.find(r=>r.id===id);if(!item||rows.length<2)return;
    event.preventDefault();clearHighlight();current.focus({preventScroll:true});
    rowOrderGesture={kind,id,deptId:dept().id,base:state,handle:current,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false,drop:null,label:kind==='course'?`${item.grade}학년 ${item.name}`:C.teacherLabel(item,rows.indexOf(item))};
    try{current.setPointerCapture?.(event.pointerId);}catch{}
  }catch(err){event.preventDefault();toast(err.message,true);}
}
function moveRowOrder(event){
  const drag=rowOrderGesture;if(!drag||event.pointerId!==drag.pointerId)return;
  if(state!==drag.base||dept().id!==drag.deptId){cancelRowOrder('순서 변경을 취소했습니다.');return;}
  event.preventDefault();drag.x=event.clientX;drag.y=event.clientY;
  if(!drag.active&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>=6){drag.active=true;document.body?.classList.add('row-order-dragging');markRowOrderSource(drag.kind,drag.id);announceRowOrder('이동할 위치에서 놓으세요. Escape로 취소합니다.');rowOrderAnimation=requestAnimationFrame(rowOrderTick);}
  if(drag.active)updateRowOrderDrop();
}
function finishRowOrder(event){
  const drag=rowOrderGesture;if(!drag||event.pointerId!==drag.pointerId)return;
  if(drag.active){event.preventDefault();drag.x=event.clientX;drag.y=event.clientY;updateRowOrderDrop();}
  const drop=drag.active?drag.drop:null,valid=state===drag.base&&dept().id===drag.deptId;cancelRowOrder();
  if(drop&&valid){try{reorderRows(drag.kind,drag.id,drop.targetId,drop.after);}catch(err){toast(err.message,true);}}
  else if(drag.active)announceRowOrder('순서 변경을 취소했습니다.');
}
function rowOrderKeydown(event){
  if(event.key==='Escape'&&(rowOrderGesture||rowOrderKeyboard)){event.preventDefault();cancelRowOrder('순서 변경을 취소했습니다.');return;}
  const handle=event.target.closest?.('[data-row-drag]');if(!handle?.dataset.rowDrag||handle.disabled||event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return;
  if(event.key==='Tab'){if(rowOrderKeyboard)cancelRowOrder('순서 변경을 취소했습니다.');return;}
  if(rowOrderGesture)return;
  const kind=handle.dataset.rowDrag,id=handle.dataset.id;
  try{
    assertRowOrder(kind);
    if(event.key===' '||event.key==='Enter'){
      event.preventDefault();if(event.repeat)return;
      if(rowOrderKeyboard){const selection=rowOrderKeyboard;cancelRowOrder();if(state!==selection.base)throw new Error('내용이 변경되어 순서 변경을 취소했습니다.');if(selection.drop)reorderRows(kind,id,selection.drop.targetId,selection.drop.after,true);}
      else{const rows=state[Order.key(kind)].filter(r=>r.deptId===dept().id);if(rows.length<2)return;rowOrderKeyboard={kind,id,handle,base:state,index:rows.findIndex(r=>r.id===id),drop:null};markRowOrderSource(kind,id);announceRowOrder('방향키로 위치를 선택하고 Enter로 적용하세요. Escape로 취소합니다.');}
      return;
    }
    if(!rowOrderKeyboard||!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    event.preventDefault();const selection=rowOrderKeyboard,rows=state[Order.key(kind)].filter(r=>r.deptId===dept().id),original=rows.findIndex(r=>r.id===id),index=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,selection.index+(event.key==='ArrowUp'?-1:1)));
    selection.index=index;selection.drop=index===original?null:{targetId:rows[index].id,after:index>original};
    document.querySelector(rowOrderSelector(kind,rows[index].id))?.scrollIntoView?.({block:'nearest',inline:'nearest'});
    const geometry=rowOrderGeometry(kind),target=geometry?.items.find(item=>item.id===selection.drop?.targetId);if(geometry)paintRowOrderLine(geometry,target?{lineY:selection.drop.after?target.bottom:target.top}:null);
    announceRowOrder(`${rows.length}개 중 ${index+1}번째 위치. Enter로 적용하세요.`);
  }catch(err){cancelRowOrder();toast(err.message,true);}
}
document.addEventListener('pointerdown',beginRowOrder);
document.addEventListener('pointermove',moveRowOrder,{passive:false});
document.addEventListener('pointerup',finishRowOrder);
document.addEventListener('pointercancel',event=>{if(rowOrderGesture?.pointerId===event.pointerId)cancelRowOrder('순서 변경을 취소했습니다.');});
document.addEventListener('lostpointercapture',event=>{if(rowOrderGesture?.pointerId===event.pointerId)cancelRowOrder();});
document.addEventListener('keydown',rowOrderKeydown);
document.addEventListener('focusin',event=>{if(rowOrderKeyboard&&event.target!==rowOrderKeyboard.handle)cancelRowOrder('순서 변경을 취소했습니다.');});
document.addEventListener('dragstart',event=>{if(event.target.closest?.('[data-row-drag]'))event.preventDefault();});
window.addEventListener('blur',()=>cancelRowOrder());
window.addEventListener('resize',()=>{if(rowOrderGesture||rowOrderKeyboard)cancelRowOrder('순서 변경을 취소했습니다.');});

function sheetView(){
  const d=dept(),gm=gridModel(),cs=gm.courses,ts=gm.teachers,cols=columns(),admin=ui.mode==='admin',editable=draft()&&!cloud.saving&&!cloud.loading,m=C.metrics(state,d.id);
  const top=cs.map((c,ci)=>{const gs=gm.groups(c.id);return `<tr class="plan-row" data-course="${c.id}"><td class="sticky-teacher plan-grade"><div class="plan-grade-content"><span>${c.grade}학년</span>${admin?rowOrderHandle('course',c.id,`${c.grade}학년 ${c.name}`,editable&&cs.length>1):''}</div></td><td class="sticky-subject">${admin?`<select data-edit="course-name" data-id="${c.id}" aria-label="${c.grade}학년 ${e(c.name)} 개설 과목" ${editable?'':'disabled'}>${courseOptions(c)}</select><div class="course-cell-tools">${btn('configure-group','분반','','mini',`data-id="${c.id}" ${editable?'':'disabled'}`)}${btn('remove-course','삭제','','mini',`data-id="${c.id}" aria-label="${e(c.name)} 개설 취소" ${editable?'':'disabled'}`)}</div>`:`${e(c.name)}`}</td>${cols.map(col=>{if(col.grade!==c.grade)return '<td class="inactive-cell"></td>';const g=gs.find(g=>g.label===col.label);if(g&&C.isSplitGroup(g)){const p=C.groupPlan(g);return `<td class="plan-cell large-cell" data-plan-column="${col.label}"><button class="split-plan-button" data-action="edit-group" data-id="${g.id}" title="${p.label} · 총 ${p.total}시간" aria-label="${e(c.name)} ${g.label} ${p.label} 분반 설정" ${admin&&editable?'':'disabled'}><span>${p.total}</span><small>${g.slots.map(s=>s.label).join('·')}</small></button></td>`;}return `<td class="plan-cell ${g?.review?'review-cell':''}" data-plan-column="${col.label}"><input data-edit="planned" data-course="${c.id}" data-column="${col.label}" type="number" min="0" max="40" value="${g?.slots[0].hours??''}" aria-label="${e(c.name)} ${col.label} 분반당 시수" ${admin&&editable?'':'disabled'}>${admin?btn('configure-group','⋯','','cell-detail',`data-id="${c.id}" data-column="${col.label}" aria-label="${e(c.name)} ${col.label} 분반 설정" ${editable?'':'disabled'}`):''}</td>`;}).join('')}<td class="sum-cell">${C.sum(gs.flatMap(g=>g.slots.map(s=>s.hours)))}</td></tr>`;}).join('');
  const appendCourse=admin?`<tr class="new-course-row"><td class="sticky-teacher"><select data-control="new-grade" aria-label="새 과목 학년" ${editable?'':'disabled'}>${[1,2,3].map(g=>`<option value="${g}" ${g===ui.grade?'selected':''}>${g}학년</option>`).join('')}</select></td><td class="sticky-subject"><select data-control="new-course" aria-label="새 개설 과목" ${editable?'':'disabled'}>${courseOptions(null,ui.newCourse)}</select></td><td colspan="${cols.length+1}" class="new-course-actions">${btn('add-course','과목 개설','plus','small',editable?'':'disabled')}</td></tr>`:'';
  const body=ts.map((t,ti)=>{const rows=gm.rows(t),unmapped=gm.unmapped(t.id);return rows.map((r,ri)=>{const c=cs.find(c=>c.id===r.courseId),gs=c?gm.groups(c.id):[];return `<tr class="teacher-row ${ri===0?'teacher-start':''}" data-teacher="${t.id}" data-course="${r.courseId}">${ri===0?`<td class="sticky-teacher teacher-name-cell" data-teacher="${t.id}" rowspan="${rows.length}"><div class="teacher-identity"><input data-edit="teacher-name" data-id="${t.id}" value="${e(t.name)}" placeholder="교사명" size="4" maxlength="50" aria-label="교사 ${ti+1} 이름" ${editable?'':'disabled'}><label class="lead-teacher"><input type="checkbox" data-edit="teacher-lead" data-id="${t.id}" aria-label="교사 ${ti+1} 부장" ${t.isLead?'checked':''} ${editable?'':'disabled'}><span>부장</span></label></div><div class="teacher-row-actions">${rowOrderHandle('teacher',t.id,C.teacherLabel(t,ti),editable&&ts.length>1)}${btn('new-teacher-subject','+ 과목','','mini',`data-id="${t.id}" ${editable?'':'disabled'}`)}${btn('delete-teacher','교사 삭제','','mini muted',`data-id="${t.id}" ${editable?'':'disabled'}`)}</div>${unmapped.length?`<button class="unmapped-link" data-action="alias" data-id="${t.id}">과목 연결 ${C.sum(unmapped.map(a=>a.hours))}h</button>`:''}</td>`:''}<td class="sticky-subject teacher-subject-cell"><div class="teacher-course-control"><select data-edit="teacher-course" data-teacher="${t.id}" data-row="${r.id}" aria-label="교사 ${ti+1} 담당 과목" ${editable?'':'disabled'}><option value="">담당 과목 선택</option>${cs.map(x=>`<option value="${x.id}" ${x.id===r.courseId?'selected':''}>${e(x.name)} (${x.grade}학년)</option>`).join('')}</select>${c||rows.length>1?btn('remove-teacher-course','삭제','','course-delete',`data-teacher="${t.id}" data-row="${r.id}" aria-label="교사 ${ti+1} ${e(c?.name??'빈 과목 행')} 삭제" ${editable?'':'disabled'}`):''}</div></td>${cols.map(col=>{if(!c||col.grade!==c.grade)return '<td class="inactive-cell"></td>';const g=gs.find(g=>g.label===col.label);if(!g)return '<td class="unopened-cell"></td>';const ready=ui.mode==='input'&&editable&&gm.canAllocate(t.id,g)?'allocation-ready':'';if(g.legacy.length){const h=C.sum(g.legacy.filter(a=>a.teacherId===t.id).map(a=>a.hours));return `<td class="pending-cell ${C.isSplitGroup(g)?'large-cell':''} ${ready}">${btn('resolve-pool',h||'·','','cell-button',`data-id="${g.id}" data-teacher="${t.id}" title="원본 합산 배정을 하위 분반에 나누기" ${editable?'':'disabled'}`)}</td>`;}if(C.isSplitGroup(g)){const actual=g.slots.map(s=>({label:s.label,hours:gm.assignment(t.id,s.id)})).filter(a=>a.hours),h=C.sum(actual.map(a=>a.hours)),labels=actual.map(a=>a.label).join(' · ');return `<td class="large-cell ${ready}"><button type="button" data-action="teacher-split" data-id="${g.id}" data-teacher="${t.id}" class="cell-button split-assignment" title="${labels||'실제 분반 선택'}" aria-label="교사 ${ti+1} ${g.label} 실제 분반 배정" ${editable?'':'disabled'}><span>${h||'선택'}</span>${labels?`<small>${e(labels)}</small>`:''}</button></td>`;}const s=g.slots[0],h=gm.assignment(t.id,s.id)||'';return `<td class="assignment-cell ${ready}"><input data-edit="allocation" data-teacher="${t.id}" data-section="${s.id}" type="number" min="0" max="${s.hours}" value="${h}" aria-label="교사 ${ti+1} ${e(c.name)} ${col.label} 담당 시수" ${editable?'':'disabled'}></td>`;}).join('')}${ri===0?`<td class="sum-cell teacher-sum" data-teacher-sum="${t.id}" rowspan="${rows.length}">${gm.hours(t.id)||''}</td>`:''}</tr>`;}).join('');}).join('');
  const tableStyle=`width:calc(var(--frozen-width) + var(--class-width) * ${cols.length} + var(--total-width))`,colgroup=`<colgroup><col class="teacher-width"><col class="subject-width">${cols.map(()=>'<col class="class-width">').join('')}<col class="total-width"></colgroup>`;
  const classHeaders=cols.map(col=>`<th scope="col" data-column="${col.label}" class="${col.kind==='moving'?'moving-head':''}">${col.caption}</th>`).join('');
  return `<div class="sheet-heading"><div class="sheet-title-line"><h1>${e(d.name)}</h1>${admin?btn('rename-dept','이름 변경','','small ghost',draft()?'':'disabled'):''}<span class="sheet-overview">${m.courseCount}개 과목 · ${m.planned}시간</span>${badge(statusText[d.status])}</div><div class="selection-context" role="status" aria-live="polite"></div></div>
  <div class="sheet-canvas">
    <section id="course-plan-frame" class="plan-scroll" data-scroll="plan" tabindex="0" aria-label="${e(d.name)} 개설 과목 계획">
      <table class="allocation-table plan-table" style="${tableStyle}">${colgroup}<thead><tr class="grade-bands"><th scope="col" class="sticky-teacher" rowspan="2">개설 과목</th><th scope="col" class="sticky-subject subject-heading" rowspan="2"><span>과목</span>${admin?btn('new-custom','과목 직접 추가','','header-add',editable?'':'disabled'):''}</th>${state.school.grades.map(g=>g.classCount+g.movingCount?`<th scope="colgroup" colspan="${g.classCount+g.movingCount}" class="grade-band">${g.grade}학년</th>`:'').join('')}<th scope="col" rowspan="2" class="total-head">합계</th></tr><tr class="class-labels">${classHeaders}</tr></thead>
      <tbody>${top||(!admin?`<tr><td class="fixed-pane-span empty-sheet" colspan="2">개설된 과목이 없습니다.</td><td colspan="${cols.length+1}"></td></tr>`:'')}${appendCourse}</tbody></table>
    </section>
    <div class="frame-resizer" data-resize="frames" role="separator" aria-orientation="horizontal" aria-label="개설 과목과 교사 배당표 높이 조절" aria-controls="course-plan-frame teacher-allocation-frame" aria-valuemin="0" aria-valuemax="100" aria-valuenow="42" tabindex="0" title="위아래로 드래그하거나 방향키로 높이 조절"></div>
    <section id="teacher-allocation-frame" class="sheet-scroll" data-scroll="teachers" tabindex="0" aria-label="${e(d.name)} 교사별 시수 배당표">
      <table class="allocation-table teacher-table" style="${tableStyle}">${colgroup}<thead><tr class="class-labels"><th class="fixed-pane-span section-title" scope="colgroup" colspan="2"><h2>교사별 시수 배분</h2></th>${classHeaders}<th scope="col" class="total-head">합계</th></tr></thead>
      <tbody>${body||`<tr><td class="fixed-pane-span empty-sheet" colspan="2">교사 행을 추가하세요.</td><td colspan="${cols.length+1}"></td></tr>`}<tr class="append-row"><td class="fixed-pane-span" colspan="2">${btn('new-teacher','교사 추가','plus','small',editable?'':'disabled')}</td><td colspan="${cols.length+1}"></td></tr></tbody></table>
    </section>
  </div>`;
}

function settingsView(){return `${heading('학교 설정','학급·이동 분반 수를 설정합니다. 교과군은 하단 시트에서 추가·전환합니다.')}<section class="panel"><div class="panel-head" style="flex-wrap:wrap"><h2>학교 설정</h2>${cloud.admin?`<div class="bottom-actions" style="margin-top:0;flex-wrap:wrap">${btn('performance','성능 측정','','small')}${apiTransport.linked?'':btn('access-password','접속 비밀번호 변경','','small')+btn('password','관리자 비밀번호 변경','','small')}</div>`:''}</div><div class="panel-body"><form id="school-form"><div class="form-grid"><label class="field">학교명<input name="name" value="${e(state.school.name)}" placeholder="학교명 입력" maxlength="80"></label><label class="field">학년도<input name="year" type="number" min="2000" max="2100" value="${state.school.year}" required></label><label class="field">학기<select name="semester"><option value="1" ${state.school.semester===1?'selected':''}>1학기</option><option value="2" ${state.school.semester===2?'selected':''}>2학기</option></select></label></div><div class="table-scroll spaced"><table class="grade-table"><thead><tr><th>학년</th><th>원반 수</th><th>이동수업 분반 수</th><th>이동수업 코드</th></tr></thead><tbody>${state.school.grades.map(g=>`<tr><td>${g.grade}학년</td><td><input name="class${g.grade}" aria-label="${g.grade}학년 원반 수" type="number" min="0" max="40" value="${g.classCount}" required></td><td><input name="moving${g.grade}" aria-label="${g.grade}학년 이동 분반 수" type="number" min="0" max="52" value="${g.movingCount}" required></td><td class="muted">${g.movingCount?`${g.grade}A부터 ${g.grade}${C.letter(g.movingCount)}까지`:'없음'}</td></tr>`).join('')}</tbody></table></div><p class="setting-note spaced">대형 분반의 하위 분반은 과목별로 지정합니다. 3C1·3C2를 개설해도 학년 전체 이동수업 코드 수는 증가하지 않습니다.</p><div class="bottom-actions"><button type="submit" class="primary">학교 설정 저장</button></div></form></div></section>`;}
function validationView(){const issues=C.validate(state,dept().id),labels={teacher:'이름 입력',pool:'배정 나누기',alias:'과목 연결',structure:'분반 설정',missing:'시수 배분',over:'배정 확인',empty:'분반 추가'};return `${heading(`${e(dept().name)} 배당 검증`,'미입력 항목과 분반별 시수 합계를 확인합니다.','')}<section class="panel"><div class="panel-head"><h2>확인 항목</h2>${badge(`${issues.length}개`,issues.length?'amber':'teal')}</div><div class="issue-list">${issues.map((x,i)=>`<div class="issue-row"><div class="issue-icon">${icon('alert')}</div><div class="issue-content"><strong>${e(x.title)}</strong><p>${e(x.detail)}</p></div>${btn('fix-issue',labels[x.type]??'확인','','small',`data-index="${i}"`)}</div>`).join('')||'<div class="empty">모든 확인 항목이 해결되었습니다.</div>'}</div></section><section class="panel"><div class="panel-body actions">${draft()?btn('submit','검증 후 제출','check','primary'):''}${ui.mode==='admin'&&dept().status==='submitted'?btn('approve','관리자 확정','check','primary'):''}${ui.mode==='admin'&&!draft()?btn('reopen','입력 다시 열기'):''}<span class="muted tiny">제출 후에는 입력을 다시 열기 전까지 수정을 잠급니다.</span></div></section>`;}

function showDialog(title,body,submit,save='적용',wide=false){dialog.className=wide?'wide':'';dialog.innerHTML=`<form id="dialog-form"><div class="dialog-head"><h2 id="dialog-title">${title}</h2>${btn('close-dialog','','close','ghost','aria-label="닫기"')}</div><div class="dialog-body">${body}</div><div id="dialog-error" class="dialog-error" role="alert"></div><div class="dialog-footer">${submit?`<button type="submit" class="primary">${save}</button>`:''}</div></form>`;document.querySelector('#dialog-form').onsubmit=async event=>{event.preventDefault();try{await submit?.(new FormData(event.currentTarget),event.currentTarget);}catch(err){document.querySelector('#dialog-error').textContent=err.message;}};if(!dialog.open)dialog.showModal();dialog.scrollTop=0;}
function confirmDialog(title,body,fn,save='확인'){showDialog(title,`<p>${body}</p>`,()=>{if(fn()!==false)dialog.close();},save);}
function deptDialog(rename=false){showDialog(rename?'교과군 시트 이름 변경':'교과군 시트 추가',`<label class="field">교과군명<input name="name" value="${rename?e(dept().name):''}" placeholder="예: 기술·가정, 교양" maxlength="30" required></label><p>학교의 교과 업무 분장에 맞게 시트 이름을 지정합니다.</p>`,f=>{const name=String(f.get('name')).trim();if(!name)throw new Error('교과군명을 입력하세요.');let created;if(mutate(rename?'교과군 이름 변경':`${name} 시트 추가`,s=>{if(s.departments.some(d=>d.name===name&&(!rename||d.id!==dept().id)))throw new Error('같은 이름의 교과군이 있습니다.');if(rename){C.assertDraft(s,dept().id);s.departments.find(d=>d.id===dept().id).name=name;}else{created=C.uid('d');s.departments.push({id:created,name,status:'draft',sourceTotal:null,note:''});C.addTeacher(s,created);}})){dialog.close();if(created){ui.deptId=created;ui.catalogGroup=R.suggestedGroup(name);cloud.context=null;}ui.view='sheet';render();}},rename?'이름 변경':'시트 추가');}
function openCatalogItem(s,item,grade){if(C.coursesOf(s,dept().id).some(c=>c.grade===grade&&R.normalize(c.name)===R.normalize(item.name)))throw new Error(`${grade}학년에 이미 개설된 과목입니다: ${item.name}`);const c=C.addCourse(s,{deptId:dept().id,name:item.name,grade,baseHours:3});Object.assign(c,{catalogId:item.id,officialGroupId:item.groupId,category:item.category,curriculum:item.curriculum});}
function customDialog(){showDialog('학교 과목 직접 추가',`<div class="form-grid"><label class="field full">과목명<input name="name" maxlength="80" required placeholder="과목명 입력"></label><label class="field">분류 교과(군)<select name="groupId">${groupOptions(ui.catalogGroup)}<option value="school" ${ui.catalogGroup==='all'?'selected':''}>학교 추가·기타</option></select></label><label class="field">과목 유형<select name="category"><option>학교추가</option>${R.categories.map(c=>`<option>${c}</option>`).join('')}</select></label><label class="field">바로 개설할 학년<select name="grade">${[1,2,3].map(g=>`<option value="${g}" ${g===ui.grade?'selected':''}>${g}학년</option>`).join('')}</select></label></div><p>직접 추가 과목은 ‘학교 추가’로 구분합니다. 현재 ${e(dept().name)} 시트에 개설합니다.</p>`,f=>{const name=String(f.get('name')).trim(),groupId=String(f.get('groupId')),category=String(f.get('category')),grade=f.get('grade');if(!name)throw new Error('과목명을 입력하세요.');if(items().some(c=>R.normalize(c.name)===R.normalize(name)))throw new Error('이미 과목 목록에 있습니다. 목록에서 선택하세요.');if(mutate(`${name} 학교 과목 추가`,s=>{s.customCatalog??=[];const item={id:C.uid('custom'),name,groupId,category,official:false,curriculum:'학교 추가'};s.customCatalog.push(item);if(grade)openCatalogItem(s,item,Number(grade));})){dialog.close();ui.catalogGroup=groupId;ui.view='sheet';render();toast('학교 과목을 추가했습니다.');}},'과목 추가');}
function groupDialog(courseId,parent){
  if(!cloud.admin||!draft()){toast('관리자 모드에서 입력을 다시 열어 주세요.',true);return;}
  const c=state.courses.find(c=>c.id===courseId),choices=columns().filter(x=>x.grade===c.grade);if(!choices.length)throw new Error('학교 설정에서 학급 또는 이동 분반을 추가하세요.');
  const existing=C.groupsOf(state,c.id),selected=parent??existing[0]?.label??choices.find(x=>x.kind==='moving')?.label??choices[0].label,g=existing.find(g=>g.label===selected),split=g?C.isSplitGroup(g):false;
  showDialog(`${e(c.name)} 분반 설정`,`<div class="form-grid"><label class="field">상위 분반<select id="group-parent" name="column" data-control="group-parent" data-course="${c.id}">${choices.map(x=>`<option value="${x.label}" ${x.label===selected?'selected':''}>${x.kind==='homeroom'?x.label.replace('-','학년 ')+'반':x.label}</option>`).join('')}</select></label><label class="field">분반 구성<select id="group-mode" name="mode" data-control="group-preview"><option value="single" ${split?'':'selected'}>분할 없음</option><option value="split" ${split?'selected':''}>실제 분반 지정</option></select></label></div>
  <div id="single-plan" ${split?'hidden':''}><label class="field">주당 시수<input id="group-hours" name="hours" data-control="group-preview" type="number" min="1" max="40" value="${split?c.baseHours:g?.slots[0].hours??c.baseHours}" ${split?'disabled':''} required></label></div>
  <div id="section-plan" class="section-plan" ${split?'':'hidden'}><div class="section-plan-heading"><span>개설할 실제 분반</span><span>주당 시수</span></div>${Array.from({length:6},(_,i)=>{const n=i+1,slot=split?g.slots.find(s=>s.label===selected+n):null;return `<div class="section-plan-row"><label><input id="group-use-${n}" name="use-${n}" type="checkbox" data-control="group-preview" ${slot?'checked':''} ${split?'':'disabled'}><span id="group-label-${n}">${selected}${n}</span></label><input id="group-hours-${n}" name="hours-${n}" data-control="group-preview" type="number" min="1" max="40" value="${slot?.hours??''}" aria-label="${selected}${n} 주당 시수" ${slot?'':'disabled'} required></div>`;}).join('')}</div>
  <div id="group-plan-preview" class="group-plan-preview">${g?e(C.groupPlan(g).label):`${selected} ${c.baseHours}시간`} · 총 ${g?C.groupPlan(g).total:c.baseHours}시간</div>${btn('remove-group','분반 개설 해제','','small ghost',`id="remove-group" data-id="${c.id}" ${g?'':'disabled'}`)}`,
  f=>{const col=choices.find(x=>x.label===f.get('column')),sections=f.get('mode')==='single'?[{label:col?.label,hours:f.get('hours')}]:Array.from({length:6},(_,i)=>i+1).filter(n=>f.get('use-'+n)).map(n=>({label:col?.label+n,hours:f.get('hours-'+n)}));C.setSectionPlan(C.clone(state),c.id,col,sections);if(mutate(`${c.name} ${col?.label??''} 분반 설정`,s=>C.setSectionPlan(s,c.id,col,sections))){dialog.close();toast('분반 설정을 적용했습니다.');}},'적용');
}
function updateGroupPreview(){
  const label=document.querySelector('#group-parent')?.value,split=document.querySelector('#group-mode')?.value==='split',out=document.querySelector('#group-plan-preview');if(!out||!label)return;
  document.querySelector('#single-plan').hidden=split;document.querySelector('#section-plan').hidden=!split;document.querySelector('#group-hours').disabled=split;
  const sections=[];for(let n=1;n<=6;n++){const use=document.querySelector('#group-use-'+n),hours=document.querySelector('#group-hours-'+n);use.disabled=!split;hours.disabled=!split||!use.checked;if(split&&use.checked){sections.push({label:label+n,hours:Number(hours.value)});}}
  if(!split)sections.push({label,hours:Number(document.querySelector('#group-hours').value)});
  out.textContent=!sections.length?'개설할 실제 분반을 선택하세요.':sections.some(s=>!Number.isInteger(s.hours)||s.hours<1||s.hours>40)?'시수를 확인하세요.':sections.map(s=>`${s.label} ${s.hours}시간`).join(' · ')+` · 총 ${C.sum(sections.map(s=>s.hours))}시간`;
}
function chooseGroupParent(courseId,label){
  const c=state.courses.find(c=>c.id===courseId),g=C.groupsOf(state,c.id).find(g=>g.label===label),split=g?C.isSplitGroup(g):false;
  document.querySelector('#remove-group').disabled=!g;document.querySelector('#group-mode').value=split?'split':'single';document.querySelector('#group-hours').value=split?c.baseHours:g?.slots[0].hours??c.baseHours;
  for(let n=1;n<=6;n++){const slot=split?g.slots.find(s=>s.label===label+n):null;document.querySelector('#group-use-'+n).checked=!!slot;document.querySelector('#group-label-'+n).textContent=label+n;const hours=document.querySelector('#group-hours-'+n);hours.value=slot?.hours??'';hours.setAttribute('aria-label',label+n+' 주당 시수');}updateGroupPreview();
}

function poolDialog(id){const g=state.groups.find(g=>g.id===id),c=state.courses.find(c=>c.id===g.courseId),ids=[...new Set(g.legacy.map(a=>a.teacherId))];showDialog(`${e(c.name)} ${g.label} · 원본 배정 나누기`,`<p>원본에는 하위 분반 구분이 없습니다. 교사별 원본 합계를 유지하여 나누어 주세요.</p><div class="table-scroll"><table class="pool-table"><thead><tr><th>교사</th><th>원본 합계</th>${g.slots.map(s=>`<th>${s.label} (${s.hours}h)</th>`).join('')}</tr></thead><tbody>${ids.map((tid,i)=>`<tr><td>${e(state.teachers.find(t=>t.id===tid).name)||`미입력 교사 행 ${C.teachersOf(state,dept().id).findIndex(t=>t.id===tid)+1}`}</td><td>${C.sum(g.legacy.filter(a=>a.teacherId===tid).map(a=>a.hours))}시간</td>${g.slots.map(s=>`<td><input name="${tid}:${s.id}" data-pool-teacher="${tid}" data-pool-section="${s.id}" type="number" min="0" max="${s.hours}" value="0" aria-label="교사 행 ${i+1} ${s.label} 시수"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`,(_,form)=>{const proposed=[...form.querySelectorAll('[data-pool-teacher]')].map(x=>({teacherId:x.dataset.poolTeacher,sectionId:x.dataset.poolSection,hours:x.value}));C.resolvePool(C.clone(state),id,proposed);if(mutate(`${c.name} ${g.label} 합산 배정 분리`,s=>C.resolvePool(s,id,proposed))){dialog.close();toast('하위 분반 배정을 적용했습니다.');}},'합계 확인 후 적용',true);}
function teacherSplitDialog(id,tid){
  const g=state.groups.find(g=>g.id===id),c=state.courses.find(c=>c.id===g.courseId),p=C.groupPlan(g),t=state.teachers.find(t=>t.id===tid);
  showDialog(`${e(c.name)} · ${g.label} 실제 분반`,`<p class="allocation-summary">${e(C.teacherLabel(t))} · ${p.label} · 전체 배정 ${C.sum(g.slots.map(s=>C.allocated(state,s.id)))} / ${p.total}시간</p><div class="split-allocation-list">${g.slots.map(s=>{const own=state.assignments.find(a=>a.sectionId===s.id&&a.teacherId===tid)?.hours??0,others=state.assignments.filter(a=>a.sectionId===s.id&&a.teacherId!==tid),capacity=s.hours-C.sum(others.map(a=>a.hours));return `<div class="split-allocation-row"><div><strong>${s.label}</strong><small>필요 ${s.hours}시간${others.length?' · '+others.map(a=>e(C.teacherLabel(state.teachers.find(t=>t.id===a.teacherId)))+' '+a.hours+'시간').join(', '):''}</small></div><label class="split-hours-label">담당 시수<input id="split-${s.id}" name="${s.id}" type="number" min="0" max="${capacity}" value="${own}" aria-label="${s.label} 담당 시수" required></label>${btn('fill-section','담당','','small',`data-id="${s.id}" data-value="${capacity}" ${capacity?'':'disabled'}`)}</div>`;}).join('')}</div>`,f=>{const values=g.slots.map(s=>({sectionId:s.id,hours:f.get(s.id)}));C.updateTeacherGroup(C.clone(state),id,tid,values);if(mutate(`${g.label} 실제 분반 담당 시수 변경`,s=>C.updateTeacherGroup(s,id,tid,values)))dialog.close();},'적용');
}
function removeTeacherCourse(teacherId,rowId){const t=state.teachers.find(t=>t.id===teacherId),row=C.teacherRows(state,teacherId).find(r=>r.id===rowId),c=state.courses.find(c=>c.id===row?.courseId),hours=row?.courseId?C.teacherCourseHours(state,teacherId,row.courseId):0,apply=()=>mutate('교사 담당 과목 삭제',s=>C.removeTeacherRow(s,teacherId,rowId));if(hours)confirmDialog('담당 과목 삭제',`${e(C.teacherLabel(t))}의 ${e(c.name)} 담당 과목과 배정 ${hours}시간을 삭제합니다.`,apply,'삭제');else apply();}

function aliasDialog(tid){const records=state.unmapped.filter(a=>a.deptId===dept().id&&(!tid||a.teacherId===tid)),name=records[0]?.sourceName;if(!name)return;const all=state.unmapped.filter(a=>a.deptId===dept().id&&a.sourceName===name),cs=C.coursesOf(state,dept().id).filter(c=>c.grade===all[0].grade);showDialog('원본 과목명 연결',`<p>원본의 ‘${e(name)}’ 배정 ${C.sum(all.map(a=>a.hours))}시간을 연결합니다. 같은 과목인지 확인하세요.</p><label class="field">연결할 과목<select name="target" required><option value="">과목 선택</option>${cs.map(c=>`<option value="${c.id}">${e(c.name)} (${c.grade}학년)</option>`).join('')}</select></label>`,f=>{C.mapSourceName(C.clone(state),dept().id,name,f.get('target'));if(mutate(`${name} 과목명 연결`,s=>C.mapSourceName(s,dept().id,name,f.get('target'))))dialog.close();},'확인 후 연결');}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function focusCell(selector,{select=true,scroll=false}={}){
  const x=document.querySelector(selector);if(!x)return;
  x.focus({preventScroll:true});
  if(scroll)x.scrollIntoView({block:'nearest',inline:'nearest'});
  if(select&&x.tagName==='INPUT'&&['text','number','search','url','tel','password'].includes(x.type)){try{x.select();}catch{}}
  return x;
}
document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b)return;if(b.dataset.view){if(!cloud.loading&&!cloud.saving)route(b.dataset.view);return;}if(b.dataset.sheet){ui.view='sheet';await selectDept(b.dataset.sheet);return;}const id=b.dataset.id;if(cloud.loading||cloud.saving){toast('자료 조회 또는 저장이 끝난 뒤 다시 실행하세요.',true);return;}if(['backup','restore','csv','timetable-transfer','timetable-sync','hours-import','reset-data'].includes(b.dataset.action)&&!cloud.admin){loginDialog();return;}
  const actions={
    'performance':showPerformance,'reset-data':resetDialog,'print-current':printCurrentForm,
    'hours-import':()=>{requireImportAdmin();document.querySelector('#hours-import-file').value='';document.querySelector('#hours-import-file').click();},
    'mode-admin':()=>cloud.admin?logoutAdmin():loginDialog(),

    'new-dept':()=>deptDialog(),'rename-dept':()=>deptDialog(true),'new-custom':customDialog,
    'new-teacher':()=>{let tid;if(mutate('빈 교사 행 추가',s=>{tid=C.addTeacher(s,dept().id).id;}))focusCell(`[data-edit=teacher-name][data-id="${tid}"]`);},
    'new-teacher-subject':()=>mutate('교사 담당 과목 행 추가',s=>C.addTeacherRow(s,id)),
    'delete-teacher':()=>confirmDialog('교사 행 삭제','배정된 시수가 없는 교사 행만 삭제할 수 있습니다.',()=>mutate('교사 행 삭제',s=>{C.assertDraft(s,dept().id);if(C.teacherHours(s,id))throw new Error('배정된 시수를 먼저 해제하세요.');s.teachers=s.teachers.filter(t=>t.id!==id);}), '삭제'),
    'remove-group':()=>{const label=document.querySelector('#group-parent').value,g=C.groupsOf(state,id).find(g=>g.label===label);if(!g)throw new Error('개설된 분반을 선택하세요.');C.removeGroup(C.clone(state),g.id);confirmDialog('분반 개설 해제',`${g.label}의 실제 분반 ${g.slots.length}개를 개설 해제합니다.`,()=>mutate(`${g.label} 분반 개설 해제`,s=>C.removeGroup(s,g.id)),'개설 해제');},'configure-group':()=>groupDialog(id,b.dataset.column),'edit-group':()=>{const g=state.groups.find(g=>g.id===id);groupDialog(g.courseId,g.label);},'remove-teacher-course':()=>removeTeacherCourse(b.dataset.teacher,b.dataset.row),'fill-section':()=>{document.querySelector('#split-'+id).value=b.dataset.value;},'resolve-pool':()=>poolDialog(id),'teacher-split':()=>teacherSplitDialog(id,b.dataset.teacher),'alias':()=>aliasDialog(id),
    'add-course':()=>{const item=items().find(c=>c.id===ui.newCourse);if(!item)throw new Error('개설할 과목을 선택하세요.');if(mutate(`${item.name} 개설`,s=>openCatalogItem(s,item,ui.grade))){ui.newCourse='';render();}},
    'remove-course':()=>{const c=state.courses.find(c=>c.id===id);confirmDialog('개설 과목 삭제',`${e(c.name)} (${c.grade}학년)을 이 시트에서 삭제합니다. 과목 목록에는 남습니다.`,()=>mutate(`${c.name} 개설 취소`,s=>C.removeCourse(s,id)),'삭제');},
    'backup':async()=>{await ensureAllDepartments();download(`교과시수배당_${state.school.year}_${state.school.semester}학기_백업.json`,JSON.stringify(state,null,2),'application/json;charset=utf-8');},
    'timetable-sync':async()=>{
      if(cloud.dirty.size||cloud.globalDirty){toast('현재 학기의 변경 내용을 먼저 저장하세요.',true);return;}
      const term=state.school.year+'-'+state.school.semester;
      confirmDialog('통합시간표로 전달',term+' 학기의 확정 분반을 통합시간표의 같은 학기로 전달할까요?',async()=>{
        try{const result=await api('/timetable-transfer','POST',{term});toast(result.term+' 학기로 분반 '+result.sections+'개를 전달했습니다.');}
        catch(error){toast(error.message,true);}
      });
    },
    'timetable-transfer':async()=>{requireImportAdmin();await ensureAllDepartments({stableGlobal:true});const data=C.timetableTransfer(state);download('시수배당_'+data.term+'.json',JSON.stringify(data,null,2),'application/json');},
    'restore':()=>{document.querySelector('#backup-file').value='';document.querySelector('#backup-file').click();},'csv':()=>download(`교과시수배당_${state.school.year}_${dept().name}.csv`,C.csv(state,dept().id),'text/csv;charset=utf-8'),
    'save-sheet':()=>saveSheet(b.dataset.id),'refresh':refreshServer,'print-form':printBlankForm,'password':passwordDialog,'access-password':accessPasswordDialog,'close-dialog':()=>dialog.close(),
    'submit':()=>{const issues=C.validate(state,dept().id);if(issues.length){toast(`${issues.length}개 확인 항목을 해결하세요.`,true);return;}confirmDialog('배당표 제출','제출하면 수정을 잠급니다. 관리자가 입력을 다시 열 수 있습니다.',()=>mutate(`${dept().name} 제출`,s=>C.changeStatus(s,dept().id,'submitted')),'제출');},
    'approve':()=>mutate(`${dept().name} 관리자 확정`,s=>C.changeStatus(s,dept().id,'locked')),'reopen':()=>mutate(`${dept().name} 입력 다시 열기`,s=>C.changeStatus(s,dept().id,'draft')),
    'fix-issue':()=>{const x=C.validate(state,dept().id)[Number(b.dataset.index)];if(!x)return;if(!draft()){toast('입력을 다시 열어 주세요.',true);return;}if(x.type==='pool')poolDialog(x.groupId);else if(x.type==='structure')groupDialog(x.courseId,state.groups.find(g=>g.id===x.groupId).label);else if(x.type==='alias')aliasDialog();else{ui.view='sheet';render();if(x.type==='teacher')focusCell(`[data-edit=teacher-name][data-id="${x.teacherId}"]`);else toast('배당표에서 해당 과목의 분반 시수를 확인하세요.');}}
  };try{await actions[b.dataset.action]?.();}catch(err){if(dialog.open)document.querySelector('#dialog-error').textContent=err.message;else toast(err.message,true);}
});
function saveInput(input){const type=input.dataset.edit,id=input.dataset.id,v=input.value;if(['planned','course-name'].includes(type)&&!cloud.admin){toast('관리자 모드에서 수정하세요.',true);return false;}const handlers={'course-name':s=>{const c=s.courses.find(c=>c.id===id),item=items().find(c=>c.id===v);if(!item)throw new Error('과목을 선택하세요.');C.assertDraft(s,c.deptId);if(s.courses.some(x=>x.id!==id&&x.deptId===c.deptId&&x.grade===c.grade&&R.normalize(x.name)===R.normalize(item.name)))throw new Error('이미 개설된 과목입니다.');Object.assign(c,{name:item.name,kind:'subject',catalogId:item.id,officialGroupId:item.groupId,category:item.category,curriculum:item.curriculum});},planned:s=>C.setPlannedCell(s,input.dataset.course,columns().find(c=>c.label===input.dataset.column),v===''?0:v),'teacher-lead':s=>{const t=s.teachers.find(t=>t.id===id);C.assertDraft(s,t.deptId);t.isLead=input.checked;},'teacher-name':s=>C.setTeacherName(s,id,v),'teacher-course':s=>C.setTeacherRow(s,input.dataset.teacher,input.dataset.row,v),allocation:s=>C.setAssignment(s,input.dataset.section,input.dataset.teacher,v===''?0:v)};if(!handlers[type])return true;
  if(type==='course-name'&&(!v||state.courses.find(c=>c.id===id)?.catalogId===v))return true;
  if(type==='teacher-lead'&&Boolean(state.teachers.find(t=>t.id===id)?.isLead)===input.checked)return true;
  if(type==='teacher-course'&&C.teacherRows(state,input.dataset.teacher).find(r=>r.id===input.dataset.row)?.courseId===v)return true;
  if(type==='planned'){const g=C.groupsOf(state,input.dataset.course).find(g=>g.label===input.dataset.column);if((g?.slots[0]?.hours??0)===Number(v||0))return true;}
  if(type==='teacher-name'&&state.teachers.find(t=>t.id===id)?.name===v.trim())return true;if(type==='allocation'&&(state.assignments.find(a=>a.sectionId===input.dataset.section&&a.teacherId===input.dataset.teacher)?.hours??0)===Number(v||0))return true;return mutateCell(({'course-name':'개설 과목 변경',planned:'분반별 필요 시수 입력','teacher-lead':'부장 표시 변경','teacher-name':'교사명 입력','teacher-course':'교사 담당 과목 지정',allocation:'교사별 담당 시수 입력'})[type],handlers[type],{...input.dataset});}
document.addEventListener('change',event=>{const x=event.target,c=x.dataset.control;if(c==='new-course'){ui.newCourse=x.value;return;}if(c==='new-grade'){ui.grade=Number(x.value);return;}if(c==='group-parent'){chooseGroupParent(x.dataset.course,x.value);return;}if(c==='group-preview'){updateGroupPreview();return;}if(x.dataset.edit){const committed=committedFields.get(x);committedFields.delete(x);if(committed&&committed.value===x.value&&committed.checked===x.checked)return;const focused=document.activeElement===x,selector=controlSelector(x);if(!saveInput(x))repaintSheetPanel();if(focused&&selector)focusCell(selector,{select:false});}});
document.addEventListener('input',event=>{if(event.target.dataset.control==='group-preview')updateGroupPreview();});
// 일반 셀 입력은 현재 교과군만 복사·검사합니다. 다른 교과군의 로컬 입력은 그대로 둡니다.
function mutateCell(label,fn,change){
  if(!cloud.ready||cloud.saving||cloud.loading){toast('연결 또는 저장을 확인하세요.',true);return false;}
  try{
    const id=dept().id,p=C.clone(S.departmentPart(state,id)),local=stateFromParts(S.globalPart(state),[p.department],[p]);
    fn(local);S.invalidateParts(local);C.assertState(local);
    const parts=new Map(S.parts(state));parts.set(id,S.departmentPart(local,id));
    state=stateFromParts(S.globalPart(state),state.departments,[...parts.values()],[{at:new Date().toISOString(),action:label},...state.history].slice(0,200));
    markDirty([id],false);queueCellPaint(change);return true;
  }catch(err){toast(err.message,true);return false;}
}
let pendingCellPaint=[],panelPaintPending=false;
function queueCellPaint(change){
  if(!['allocation','teacher-name','teacher-lead'].includes(change.edit))panelPaintPending=true;
  else pendingCellPaint.push({...change});
  paintPending=true;if(!renderPause)flushInputPaint();
}
function paintSaveState(){
  const save=document.querySelector('.header-save');if(save)save.textContent=cloud.saving?'저장 중':cloud.loading?'자료 조회 중':cloud.dirty.has(dept().id)||cloud.globalDirty?'저장 전':'저장됨';
  for(const d of state.departments){const dot=document.querySelector(`.sheet-tab[data-sheet="${d.id}"] .unsaved-dot`);if(dot)dot.hidden=!cloud.dirty.has(d.id);}
  for(const [kind,ids,prefix] of [['import',ui.importedDeptIds,'분반배정 가져오기 적용됨'],['reset',ui.resetDeptIds,'초기화 적용됨']]){
    const notice=document.querySelector(`[data-pending="${kind}"]`);if(!notice)continue;
    const pending=(ids||[]).filter(id=>cloud.dirty.has(id));notice.hidden=!pending.length;
    notice.textContent=prefix+' · 저장할 교과군: '+pending.map(id=>state.departments.find(d=>d.id===id)?.name||'').join(' · ');
  }
}
function repaintSheetPanel(){
  const teacher=document.querySelector('.sheet-scroll'),plan=document.querySelector('.plan-scroll'),scroll={left:teacher?.scrollLeft||0,top:teacher?.scrollTop||0,planTop:plan?.scrollTop||0};
  const main=document.querySelector('#main');if(!main||ui.view!=='sheet'){render();return;}
  main.innerHTML=sheetView();applyFrameSize();alignHorizontalScroll(scroll.left);observeHorizontalFrames();
  const next=document.querySelector('.sheet-scroll'),nextPlan=document.querySelector('.plan-scroll');if(next){next.scrollTop=scroll.top;next.scrollLeft=scroll.left;}if(nextPlan)nextPlan.scrollTop=scroll.planTop;
  paintSaveState();applyHighlight();
}
function paintCellChanges(changes){
  if(ui.view!=='sheet'){render();return;}
  const model=gridModel();
  for(const x of changes){
    if(x.edit==='allocation'){
      const g=model.slotGroups.get(x.section);if(!g)continue;
      for(const input of document.querySelectorAll(`[data-edit="allocation"][data-section="${x.section}"]`)){
        const own=model.assignment(input.dataset.teacher,x.section);input.value=own||'';
        const cell=input.closest('td'),ready=ui.mode==='input'&&draft()&&!cloud.saving&&!cloud.loading&&model.canAllocate(input.dataset.teacher,g);
        if(cell)cell.classList[ready?'add':'remove']('allocation-ready');
      }
      const total=document.querySelector(`[data-teacher-sum="${x.teacher}"]`);if(total)total.textContent=model.hours(x.teacher)||'';
    }else{
      const t=state.teachers.find(t=>t.id===x.id);if(!t)continue;
      const name=document.querySelector(`[data-edit="teacher-name"][data-id="${t.id}"]`),lead=document.querySelector(`[data-edit="teacher-lead"][data-id="${t.id}"]`);
      if(name)name.value=t.name;if(lead)lead.checked=Boolean(t.isLead);
      const index=model.teachers.findIndex(t=>t.id===x.id),handle=document.querySelector(`[data-row-drag="teacher"][data-id="${t.id}"]`);
      if(handle){handle.setAttribute('aria-label',C.teacherLabel(t,index)+' 순서 드래그');handle.setAttribute('title','드래그하여 순서 변경 · 키보드: Space, 방향키, Enter');}
    }
  }
  paintSaveState();applyHighlight();
}
function flushInputPaint(){
  if(!paintPending||renderPause)return;
  const focused=controlSelector(document.activeElement),changes=pendingCellPaint;pendingCellPaint=[];paintPending=false;
  if(panelPaintPending){panelPaintPending=false;repaintSheetPanel();}else if(changes.length)paintCellChanges(changes);else render();
  if(focused)focusCell(focused,{select:false});
}
// 화면을 그릴 때 현재 교과군의 자료를 한 번만 모아 셀 조회에 재사용합니다.
function gridModel(){
  const orderedGroups=[],slotTeachers=new Map();
  const id=dept().id,teachers=state.teachers.filter(t=>t.deptId===id),courses=state.courses.filter(c=>c.deptId===id),courseIds=new Set(courses.map(c=>c.id)),groups=new Map(courses.map(c=>[c.id,[]])),slotGroups=new Map(),assigned=new Map(),allocated=new Map(),totals=new Map(),assignedCourses=new Map(),unmapped=new Map(teachers.map(t=>[t.id,[]]));
  for(const g of state.groups){if(!courseIds.has(g.courseId))continue;groups.get(g.courseId).push(g);orderedGroups.push(g);for(const s of g.slots)slotGroups.set(s.id,g);for(const a of g.legacy)totals.set(a.teacherId,(totals.get(a.teacherId)||0)+a.hours);}
  for(const a of state.assignments){if(!slotGroups.has(a.sectionId))continue;assigned.set(a.teacherId+':'+a.sectionId,a.hours);if(!slotTeachers.has(a.sectionId))slotTeachers.set(a.sectionId,[]);slotTeachers.get(a.sectionId).push(a.teacherId);allocated.set(a.sectionId,(allocated.get(a.sectionId)||0)+a.hours);totals.set(a.teacherId,(totals.get(a.teacherId)||0)+a.hours);}
  for(const a of state.unmapped){if(unmapped.has(a.teacherId)){unmapped.get(a.teacherId).push(a);totals.set(a.teacherId,(totals.get(a.teacherId)||0)+a.hours);}}
  for(const g of orderedGroups){const tids=new Set([...g.legacy.map(a=>a.teacherId),...g.slots.flatMap(s=>slotTeachers.get(s.id)||[])]);for(const tid of tids){if(!assignedCourses.has(tid))assignedCourses.set(tid,[]);const ids=assignedCourses.get(tid);if(!ids.includes(g.courseId))ids.push(g.courseId);}}
  return {teachers,courses,slotGroups,groups:id=>groups.get(id)||[],assignment:(tid,sid)=>assigned.get(tid+':'+sid)||0,hours:tid=>totals.get(tid)||0,unmapped:tid=>unmapped.get(tid)||[],
    rows:t=>{const rows=(t.rows||[]).map(r=>({...r}));for(const cid of assignedCourses.get(t.id)||[])if(!rows.some(r=>r.courseId===cid))rows.push({id:`row-${t.id}-${cid}`,courseId:cid});return rows.length?rows:[{id:`row-${t.id}-blank`,courseId:''}];},
    canAllocate:(tid,g)=>g.legacy.length?g.legacy.some(a=>a.teacherId===tid&&a.hours>0):g.slots.some(s=>assigned.has(tid+':'+s.id)||(allocated.get(s.id)||0)<s.hours)};
}

const GRID_CONTROL='input[data-edit="planned"],input[data-edit="allocation"],button[data-action="edit-group"],button[data-action="teacher-split"],button[data-action="resolve-pool"]';
const FOCUSABLE_CONTROL='button,input,select,textarea,a[href],[tabindex]';
const committedFields=new WeakMap();
let renderPause=0,paintPending=false;

function controlSelector(node){
  if(!node?.tagName)return null;
  if(node.id)return '#'+node.id;
  const attrs=Object.entries(node.dataset??{}).map(([key,value])=>`[data-${key.replace(/[A-Z]/g,ch=>'-'+ch.toLowerCase())}="${String(value).replace(/[\\"]/g,'\\$&')}"]`).join('');
  return attrs?node.tagName.toLowerCase()+attrs:null;
}
function canFocus(node){return !node.disabled&&node.type!=='hidden'&&node.tabIndex>=0&&!node.closest('[hidden]')&&node.getClientRects().length>0;}
function gridControls(){return [...document.querySelectorAll(GRID_CONTROL)].filter(canFocus);}
function columnOf(node){
  if(node.dataset.edit==='planned')return node.dataset.column;
  const group=node.dataset.section?C.groupOfSection(state,node.dataset.section):state.groups.find(g=>g.id===node.dataset.id);
  return group?.label;
}
function adjacentGridControl(node,key){
  const all=gridControls(),row=node.closest('tr');
  if(key==='ArrowLeft'||key==='ArrowRight'){
    const cells=all.filter(x=>x.closest('tr')===row),i=cells.indexOf(node);
    return cells[i+(key==='ArrowLeft'?-1:1)]??null;
  }
  const rows=[...new Set(all.map(x=>x.closest('tr')))],step=key==='ArrowUp'?-1:1,column=columnOf(node);
  for(let i=rows.indexOf(row)+step;i>=0&&i<rows.length;i+=step){const next=all.find(x=>x.closest('tr')===rows[i]&&columnOf(x)===column);if(next)return next;}
  return null;
}
function tabControl(node,backwards){
  const step=backwards?-1:1;
  if(node.matches(GRID_CONTROL)){
    const cells=gridControls(),next=cells[cells.indexOf(node)+step];if(next)return next;
  }
  const all=[...document.querySelectorAll(FOCUSABLE_CONTROL)].filter(canFocus),i=all.indexOf(node);
  return i<0?null:all[i+step]??null;
}
function commitField(node){
  if(!node?.dataset?.edit||!['INPUT','SELECT'].includes(node.tagName))return true;
  renderPause++;
  try{const ok=saveInput(node);if(ok)committedFields.set(node,{value:node.value,checked:node.checked});return ok;}
  finally{renderPause--;}
}

function clearHighlight(){cloud.context=null;applyHighlight();}
function highlightControl(node){
  const x=node?.dataset;if(!x||!state){clearHighlight();return;}
  if(x.action==='edit-group'){
    const g=state.groups.find(g=>g.id===x.id);cloud.context=g?{teacher:'',course:g.courseId,column:g.label,planGroup:g.id}:null;
  }else if(['teacher-split','resolve-pool'].includes(x.action)){
    const g=state.groups.find(g=>g.id===x.id);cloud.context=g?{teacher:x.teacher,course:g.courseId,column:g.label,group:g.id}:null;
  }else if(x.edit==='allocation'){
    const g=C.groupOfSection(state,x.section);cloud.context=g?{teacher:x.teacher,course:g.courseId,column:g.label,section:x.section}:null;
  }else if(x.edit==='planned')cloud.context={teacher:'',course:x.course,column:x.column};
  else if(['teacher-name','teacher-lead'].includes(x.edit))cloud.context={teacher:x.id,course:'',column:''};
  else if(x.edit==='teacher-course')cloud.context={teacher:x.teacher,course:C.teacherRows(state,x.teacher).find(r=>r.id===x.row)?.courseId||'',column:''};
  else if(x.edit==='course-name')cloud.context={teacher:'',course:x.id,column:''};
  else cloud.context=null;
  applyHighlight();
}


document.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
  const node=event.target;if(!node.closest?.('.allocation-table')||node.disabled)return;
  const grid=node.matches(GRID_CONTROL),arrow=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key);
  if(event.key==='Escape'&&grid){
    if(commitField(node)){event.preventDefault();clearHighlight();node.blur();flushInputPaint();}return;
  }
  if(arrow&&(!grid||event.shiftKey))return;
  if(!arrow&&event.key!=='Tab'&&!(event.key==='Enter'&&node.tagName==='INPUT'))return;
  if(event.key==='Tab'&&!grid&&!node.dataset.edit)return;
  const next=arrow?adjacentGridControl(node,event.key):tabControl(node,event.shiftKey),selector=controlSelector(next);
  // Let Tab leave the document at its natural boundary without trapping focus.
  if(!next&&event.key==='Tab'){if(!commitField(node))event.preventDefault();return;}
  event.preventDefault();if(!commitField(node))return;
  if(paintPending)flushInputPaint();
  if(selector)focusCell(selector,{scroll:true});
  else{const current=controlSelector(node);if(current)focusCell(current,{select:false});}
});

document.addEventListener('pointerdown',event=>{
  const node=event.target,active=document.activeElement,action=node.closest?.('[data-action]')?.dataset.action;
  if(action==='print-current')ui.printCommitFailed=false;
  if(active!==node&&active?.closest?.('.allocation-table')&&active.dataset.edit){
    if(commitField(active))active.blur();else if(action==='print-current'){ui.printCommitFailed=true;event.preventDefault();}
  }
  const control=node.closest?.(GRID_CONTROL);
  if(!control||control.disabled)clearHighlight();
},true);
document.addEventListener('click',flushInputPaint);
document.addEventListener('pointercancel',flushInputPaint);

window.addEventListener('blur',()=>{const active=document.activeElement;if(active?.closest?.('.allocation-table')&&active.dataset.edit){commitField(active);active.blur();}if(paintPending)flushInputPaint();clearHighlight();});
document.addEventListener('submit',async event=>{if(event.target.id!=='school-form')return;event.preventDefault();const f=new FormData(event.target),value={name:String(f.get('name')).trim(),year:Number(f.get('year')),semester:Number(f.get('semester')),grades:[1,2,3].map(grade=>({grade,classCount:Number(f.get('class'+grade)),movingCount:Number(f.get('moving'+grade))}))};const term=value.year+'-'+value.semester;
 if(term!==state.school.year+'-'+state.school.semester){
   if(cloud.dirty.size||cloud.globalDirty){toast('현재 학기의 변경 내용을 먼저 저장하세요.',true);return;}
   confirmDialog('학기 전환',term+' 학기로 전환할까요? 현재 작업본은 학기별로 보관됩니다.',async()=>{try{await api('/term','POST',{term});await initialize();}catch(error){toast(error.message,true);}});return;
 }
 try{await ensureAllDepartments({stableGlobal:true});if(mutate('학교·학급 구성 변경',s=>{if(s.departments.some(d=>d.status!=='draft'))throw new Error('제출·확정된 시트의 입력을 다시 연 후 수정하세요.');C.validateSchool(s,value);s.school=value;}))await saveGlobalOnly();}catch(err){toast(err.message,true);}});
document.querySelector('#backup-file').addEventListener('change',async event=>{if(!cloud.admin){loginDialog();return;}const file=event.target.files[0];if(!file)return;try{if(file.size>5000000)throw new Error('파일이 너무 큽니다.');const next=C.assertState(C.upgradeState(JSON.parse(await file.text()),defaultNameHashes));await ensureAllDepartments();confirmDialog('백업 복원','현재 작업본을 교체합니다. 교과군별 저장 버튼으로 반영합니다.',()=>{if(cloud.saving||cloud.loading)throw new Error('자료 조회 또는 저장이 끝난 뒤 다시 실행하세요.');state=next;cloud.loaded=new Set(next.departments.map(d=>d.id));markDirty();render();});}catch(err){toast(err.message,true);}});
function assertResetAdmin(){if(!cloud.admin||ui.mode!=='admin')throw new Error('관리자 모드에서 초기화하세요.');if(!cloud.ready||cloud.saving||cloud.loading||ui.printing)throw new Error('연결·저장·인쇄 상태를 확인하세요.');}
function resetDialog(){
  assertResetAdmin();cancelRowOrder();const deptId=dept().id,name=e(dept().name);
  showDialog('입력 자료 초기화',`<div class="reset-options">
    <label><input type="radio" name="reset-scope" value="hours" checked><span><strong>${name} 담당 시수만 초기화</strong><small>교사별 배정 시수와 미연결 원본 배정을 비웁니다. 교사명·담당 과목 행·부장 표시·개설 과목·분반은 유지합니다.</small></span></label>
    <label><input type="radio" name="reset-scope" value="department"><span><strong>${name} 과목·교사 전체 초기화</strong><small>현재 교과군의 개설 과목·분반·교사·배정 자료를 모두 비웁니다.</small></span></label>
    <label><input type="radio" name="reset-scope" value="all"><span><strong>전체 교과군 입력 자료 초기화</strong><small>모든 교과군의 개설 과목·분반·교사·배정 자료를 비웁니다.</small></span></label>
    </div><p class="reset-note">학교 설정·교과군명·과목 선택 목록·비밀번호는 유지합니다. 대상 교과군은 ‘입력 중’으로 전환합니다.</p><p class="reset-note"><strong>초기화는 화면에 먼저 적용되며, 해당 교과군을 저장하면 서버에 반영됩니다.</strong> 저장 전에는 ‘불러오기’로 서버 저장본을 다시 가져올 수 있습니다.</p>`,async f=>{
    assertResetAdmin();const scope=String(f.get('reset-scope')||'');if(scope==='all')await ensureAllDepartments();assertResetAdmin();const result=Reset.apply(state,scope,deptId);
    if(mutate('입력 자료 초기화: '+({hours:'담당 시수',department:'현재 교과군',all:'전체 교과군'}[scope]||''),s=>Object.assign(s,result.state))){
      dialog.close();ui.resetDeptIds=result.departmentIds;ui.importedDeptIds=(ui.importedDeptIds||[]).filter(id=>!result.departmentIds.includes(id));ui.view='sheet';ui.deptId=deptId;cloud.context=null;render();toast('초기화했습니다. 변경한 교과군을 저장해 주세요.');
    }
  },'선택 범위 초기화');
}

function requireImportAdmin(){if(!cloud.ready||cloud.saving||cloud.loading)throw new Error('연결 또는 저장을 확인하세요.');if(!cloud.admin||ui.mode!=='admin')throw new Error('관리자 모드에서 가져오세요.');}
function hoursImportDialog(data,initial){
  requireImportAdmin();const options=initial||H.defaults(data,state);
  const body=`<p>분반배정 결과를 교과군별 개설 과목·이동 분반·필요 시수로 가져옵니다. 대상 학년과 교과군을 확인하세요.</p>
    <div class="form-grid"><label class="field">학년도<input name="import-year" type="number" min="2000" max="2100" value="${e(options.year)}"></label><label class="field">학기<select name="import-semester">${[1,2].map(s=>`<option value="${s}" ${Number(options.semester)===s?'selected':''}>${s}학기</option>`).join('')}</select></label></div>
    <datalist id="import-departments">${state.departments.map(d=>`<option value="${e(d.name)}"></option>`).join('')}</datalist>
    <p class="setting-note">교과군명과 배당표 과목명이 기존 항목과 일치하면 연결합니다. 새 이름은 새로 개설합니다. 주당 시수는 학점 기준 초기값이므로 실제 운영 시수를 확인하세요.</p>
    ${data.sheets.map((sheet,si)=>{const option=options.sheets[si];return `<section class="hours-import-sheet"><div class="hours-import-sheet-head"><label><input type="checkbox" name="include-${si}" ${option.include?'checked':''}> ${e(sheet.name)}</label><label>대상 학년 <select name="grade-${si}" aria-label="${e(sheet.name)} 대상 학년"><option value="">학년 선택</option>${[1,2,3].map(g=>`<option value="${g}" ${Number(option.grade)===g?'selected':''}>${g}학년</option>`).join('')}</select></label></div><div class="table-scroll"><table class="hours-import-table"><thead><tr><th>선택</th><th>원본 과목</th><th>교과군</th><th>배당표 과목명</th><th>주당 시수</th><th>분반 수</th></tr></thead><tbody>${sheet.courses.map((c,ci)=>{const row=option.courses[ci],key=si+'-'+ci;return `<tr><td><input type="checkbox" name="course-${key}" aria-label="${e(c.name)} 가져오기" ${row.include?'checked':''}></td><td>${e(c.name)}<small>${c.credits==null?'':c.credits+'학점'} · ${e([...new Set(c.sections.map(s=>s.code))].join('·'))}</small></td><td><input name="dept-${key}" list="import-departments" value="${e(row.deptName)}" maxlength="30" aria-label="${e(c.name)} 교과군" placeholder="선택 또는 새 이름"></td><td><input name="name-${key}" value="${e(row.name)}" maxlength="100" aria-label="${e(c.name)} 배당표 과목명"></td><td><input name="hours-${key}" type="number" min="1" max="40" value="${e(row.hours)}" aria-label="${e(c.name)} 주당 시수"></td><td>${c.sections.length}</td></tr>`;}).join('')}</tbody></table></div>${sheet.links.length?`<p class="setting-note">동일 학생 결합 ${sheet.links.length}건: 과목별로 선택할 수 있습니다. 선택한 과목의 시수만 가져옵니다.</p>`:''}</section>`;}).join('')}
    <div class="hours-import-warning"><p>선택한 과목의 이동 분반은 업로드 결과로 갱신합니다. 기존 원반과 다른 과목은 유지합니다. 동일 분반의 교사 배정은 유지하며, 삭제·시수 축소와 충돌하면 적용을 중단합니다.</p><label><input type="checkbox" name="clear-import-assignments" ${options.clearAssignments?'checked':''}> 선택한 과목의 기존 이동 분반 교사 배정을 해제하고 가져오기</label></div>`;
  showDialog('분반배정 가져오기',body,f=>{
    requireImportAdmin();
    const selected={year:Number(f.get('import-year')),semester:Number(f.get('import-semester')),clearAssignments:Boolean(f.get('clear-import-assignments')),sheets:data.sheets.map((sheet,si)=>({include:Boolean(f.get('include-'+si)),grade:f.get('grade-'+si),courses:sheet.courses.map((c,ci)=>{const key=si+'-'+ci;return {include:Boolean(f.get('course-'+key)),name:String(f.get('name-'+key)||''),deptName:String(f.get('dept-'+key)||''),hours:f.get('hours-'+key)};})}))};
    const base=state,result=H.plan(data,state,selected);
    const summary=`<p><strong>${result.summary.length}과목 · 실제 분반 ${result.sectionCount}개 · 총 ${result.total}시간</strong>을 적용합니다. 적용 후 변경한 교과군별로 저장하세요.</p>${result.clearedHours?`<p class="hours-import-warning">기존 이동 분반의 교사 배정 ${result.clearedHours}시간을 해제합니다.</p>`:''}<div class="table-scroll"><table class="hours-import-table"><thead><tr><th>교과군</th><th>과목</th><th>실제 분반·시수</th><th>이동 분반 시수</th></tr></thead><tbody>${result.summary.map(s=>`<tr><td>${e(s.department)}</td><td>${s.grade}학년 ${e(s.name)}</td><td>${s.sections.map(a=>`${e(a.label)} ${a.hours}`).join(' · ')}</td><td>${s.oldTotal} → ${s.total}시간</td></tr>`).join('')}</tbody></table></div><p class="setting-note">대분반 ${C.sum(result.summary.map(s=>s.splitCount))}곳 · 동일 학생 결합 ${result.linkCount}건${result.individualSectionCount?' · 개별 선택 분반 '+result.individualSectionCount+'개':''}. 교사별 담당 시수는 배당표에서 입력합니다.</p><p class="setting-note">학년도 ${result.state.school.year} · ${result.state.school.semester}학기. 이동수업 열은 필요한 만큼 확장합니다.</p><button id="hours-import-back" type="button" class="small">설정 다시</button>`;
    showDialog('가져오기 미리보기',summary,()=>{
      requireImportAdmin();if(state!==base)throw new Error('작업 내용이 변경되었습니다. 설정을 다시 열어 확인하세요.');
      if(mutate('분반배정 JSON 가져오기',s=>Object.assign(s,C.clone(result.state)))){
        dialog.close();ui.deptId=result.departmentIds[0];ui.view='sheet';ui.importedDeptIds=result.departmentIds;cloud.context=null;render();toast('가져왔습니다. 변경한 교과군별 저장 버튼을 눌러 주세요.');
      }
    },result.clearedHours?'기존 배정 해제 후 적용':'확인 후 적용',true);
    dialog.classList.add('hours-import-dialog');document.querySelector('#hours-import-back').onclick=()=>hoursImportDialog(data,selected);
  },'미리보기',true);
  dialog.classList.add('hours-import-dialog');
}
document.querySelector('#hours-import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{requireImportAdmin();if(file.size>5000000)throw new Error('5MB 이하의 JSON 파일을 선택하세요.');const raw=JSON.parse((await file.text()).replace(/^\uFEFF/,''));const data=H.parse(raw);await ensureAllDepartments();hoursImportDialog(data);}
  catch(err){toast(err instanceof SyntaxError?'JSON 파일 형식이 올바르지 않습니다.':err.message,true);}
  finally{event.target.value='';}
});


window.addEventListener('beforeunload',event=>{if(cloud.dirty.size||cloud.globalDirty){event.preventDefault();event.returnValue='';}});
function emptyPart(department){return {department:{...department,sourceTotal:null,note:''},teachers:[],courses:[],groups:[],assignments:[],unmapped:[]};}
function stateFromParts(global,departments,parts,history=[]){
  const byId=new Map(parts.map(p=>[p.department.id,p]));
  const ordered=departments.map(d=>byId.get(d.id)||emptyPart(d));
  return S.rememberParts({schemaVersion:1,uiVersion:3,school:global.school,source:global.source??{},customCatalog:global.customCatalog??[],departments:ordered.map(p=>p.department),teachers:ordered.flatMap(p=>p.teachers),courses:ordered.flatMap(p=>p.courses),groups:ordered.flatMap(p=>p.groups),assignments:ordered.flatMap(p=>p.assignments),unmapped:ordered.flatMap(p=>p.unmapped),history},ordered);
}
function adopt(result){
  if(apiTransport.linked){cloud.admin=result.admin===true;ui.mode=cloud.admin?'admin':'input';}
  if(!result.partial){
    const next=C.assertState(result.state);state=next;cloud.loaded=new Set(next.departments.map(d=>d.id));cloud.scoped=false;
    cloud.base=Object.fromEntries(next.departments.map(d=>[d.id,C.clone(S.departmentPart(next,d.id))]));
  }else{
    const next=C.assertState(stateFromParts(result.global,result.departments,result.parts));state=next;cloud.scoped=true;
    cloud.loaded=new Set(result.parts.map(p=>p.department.id));cloud.base=Object.fromEntries(result.parts.map(p=>[p.department.id,C.clone(p)]));
    ui.deptId=result.selectedDepartmentId;
  }
  cloud.globalRevision=result.globalRevision;cloud.revisions={...result.revisions};cloud.globalBase=C.clone(S.globalPart(state));cloud.dirty.clear();cloud.globalDirty=false;cloud.ready=true;
}
function mergeWorkspace(result){
  if(result.admin===false&&cloud.admin){cloud.admin=false;ui.mode='input';}
  if(!result.partial){
    result={partial:true,global:S.globalPart(result.state),departments:result.state.departments,parts:result.state.departments.map(d=>S.departmentPart(result.state,d.id)),globalRevision:result.globalRevision,revisions:result.revisions};
  }
  if(result.globalRevision!==cloud.globalRevision){
    if(cloud.dirty.size||cloud.globalDirty)throw Object.assign(new Error('학교 설정이 변경되었습니다. 저장 전 내용을 보존했습니다. 변경 내용을 확인한 뒤 불러오기를 사용하세요.'),{code:'global_conflict',status:409});
    adopt({...result,selectedDepartmentId:result.selectedDepartmentId||ui.deptId});return;
  }
  const parts=new Map(state.departments.filter(d=>cloud.loaded.has(d.id)).map(d=>[d.id,S.departmentPart(state,d.id)])),base={...cloud.base},revisions={...cloud.revisions},loaded=new Set(cloud.loaded);
  for(const p of result.parts){
    const id=p.department.id;if(cloud.dirty.has(id))continue;
    parts.set(id,p);base[id]=C.clone(p);revisions[id]=result.revisions[id];loaded.add(id);
  }
  // 로컬에서 새로 만든 교과군과 아직 저장하지 않은 학교 설정을 함께 유지합니다.
  const global=cloud.globalDirty?S.globalPart(state):result.global;
  const departments=global.departmentIds.map(id=>parts.get(id)?.department||result.departments.find(d=>d.id===id)||state.departments.find(d=>d.id===id));
  const next=C.assertState(stateFromParts(global,departments,[...parts.values()],state.history));
  state=next;cloud.base=base;cloud.revisions=revisions;cloud.loaded=loaded;
}
async function initialize(){
  try{const r=await api('/workspace');const renderStart=performance.now();adopt(r);render();metrics.render(performance.now()-renderStart);}
  catch(err){
    cloud.ready=false;
    app.innerHTML='<div class="loading"><h1>시수배당표</h1><p>'+e(err.message)+'</p>'+btn('refresh','다시 연결')+
      (!apiTransport.linked&&!cloud.admin?'<button type="button" id="linked-admin">관리자 로그인</button>':'')+'</div>';
    const login=document.querySelector('#linked-admin');if(login)login.onclick=()=>loginDialog();
  }
}
async function selectDept(id){
  if(cloud.saving||cloud.fullLoading||ui.printing)return;
  if(!state.departments.some(d=>d.id===id))return;
  const ticket=++cloud.loadTicket;
  if(cloud.loaded.has(id)){
    cloud.loading=false;ui.deptId=id;ui.newCourse='';cloud.context=null;ui.catalogGroup=R.suggestedGroup(dept().name);render();return;
  }
  cloud.loading=true;render();
  try{
    const result=await api('/workspace','GET',{departmentId:id});
    if(ticket!==cloud.loadTicket)return;
    mergeWorkspace(result);ui.deptId=id;ui.newCourse='';cloud.context=null;ui.catalogGroup=R.suggestedGroup(dept().name);
  }catch(err){if(ticket===cloud.loadTicket)toast(err.message,true);}
  finally{if(ticket===cloud.loadTicket){cloud.loading=false;render();}}
}
async function ensureAllDepartments({stableGlobal=false}={}){
  if(state.departments.every(d=>cloud.loaded.has(d.id)))return;
  if(cloud.loading||cloud.saving||cloud.fullLoading)throw new Error('자료 조회 또는 저장이 끝난 뒤 다시 실행하세요.');
  cloud.fullLoading=true;cloud.loading=true;cloud.loadTicket++;render();
  try{const result=await api('/workspace','GET',{all:true,departmentId:dept().id});if(stableGlobal&&result.globalRevision!==cloud.globalRevision)throw new Error('학교 설정이 다른 곳에서 변경되었습니다. 변경 내용을 확인한 뒤 다시 입력하세요.');mergeWorkspace(result);}
  finally{cloud.fullLoading=false;cloud.loading=false;render();}
}
function markDirty(ids=null,includeGlobal=true){
  if(includeGlobal)cloud.globalDirty=!S.same(S.globalPart(state),cloud.globalBase);
  for(const id of ids||cloud.loaded){
    if(!state.departments.some(d=>d.id===id)){cloud.dirty.delete(id);continue;}
    if(S.same(S.departmentPart(state,id),cloud.base[id]))cloud.dirty.delete(id);else cloud.dirty.add(id);
  }
}
async function saveGlobal(){
  if(!cloud.globalDirty)return;
  if(!cloud.admin)throw new Error('관리자 모드에서 학교 설정을 저장하세요.');
  const g=C.clone(S.globalPart(state)),added=g.departmentIds.filter(id=>!cloud.globalBase.departmentIds.includes(id)).map(id=>C.clone(S.departmentPart(state,id)));
  const r=await api('/global','PUT',{revision:cloud.globalRevision,global:g,newSheets:added});
  cloud.globalRevision=r.globalRevision;cloud.globalBase=g;Object.assign(cloud.revisions,r.newRevisions);
  for(const p of added){cloud.base[p.department.id]=p;cloud.loaded.add(p.department.id);}markDirty(null,true);
}
// Keep the live table and restore every control's previous disabled state after saving.
const saveDisabled=new Map();
function paintSaving(){
  if(cloud.saving){
    for(const control of document.querySelectorAll('#app button,#app input,#app select,#app textarea')){
      if(!saveDisabled.has(control))saveDisabled.set(control,control.disabled);control.disabled=true;
    }
  }else{for(const [control,disabled] of saveDisabled)control.disabled=disabled;saveDisabled.clear();}
  app.setAttribute('aria-busy',String(cloud.saving));paintSaveState();
}
function prepareSave(){
  const active=document.activeElement;
  if(active?.closest?.('.allocation-table')&&active.dataset.edit&&!commitField(active))return false;
  flushInputPaint();return true;
}
async function saveSheet(id){
  if(cloud.saving||cloud.loading||!cloud.loaded.has(id)||!prepareSave())return;
  if(!cloud.globalDirty&&!cloud.dirty.has(id)){toast('저장되었습니다.');return;}
  const priorRoot=app.firstElementChild,priorMode=ui.mode;cloud.saving=true;paintSaving();
  try{
    await saveGlobal();
    if(cloud.dirty.has(id)){
      const p=C.clone(S.departmentPart(state,id));
      const r=await api('/sheets/'+encodeURIComponent(id),'PUT',{part:p,revision:cloud.revisions[id],globalRevision:cloud.globalRevision,operationId:C.uid('save')});
      cloud.revisions[id]=r.revision;cloud.base[id]=p;markDirty([id],false);toast(p.department.name+' 저장 완료');
    }else toast('저장되었습니다.');
  }catch(err){if(err.status===403){cloud.admin=false;ui.mode='input';ui.view='sheet';}toast(err.message,true);}
  finally{cloud.saving=false;paintSaving();if(app.firstElementChild!==priorRoot||ui.mode!==priorMode)render();}
}
async function saveGlobalOnly(){
  if(cloud.saving||cloud.loading)return;
  if(!cloud.globalDirty){toast('학교 설정 저장 완료');return;}
  const priorRoot=app.firstElementChild,priorMode=ui.mode;cloud.saving=true;paintSaving();
  try{await saveGlobal();toast('학교 설정 저장 완료');}catch(err){if(err.status===403){cloud.admin=false;ui.mode='input';ui.view='sheet';}toast(err.message,true);}
  finally{cloud.saving=false;paintSaving();if(app.firstElementChild!==priorRoot||ui.mode!==priorMode)render();}
}

function refreshServer(){
  if(cloud.saving||cloud.loading||ui.printing)return;
  const load=async()=>{cloud.loading=true;cloud.loadTicket++;render();try{adopt(await api('/workspace','GET',{departmentId:dept().id}));render();toast('불러왔습니다.');}catch(err){toast(err.message,true);}finally{cloud.loading=false;render();}};
  if(cloud.dirty.size||cloud.globalDirty)confirmDialog('최신 내용 불러오기','저장 전 변경을 버리고 서버 내용을 불러옵니다.',()=>{load();});else if(!cloud.ready)initialize();else load();
}

await initialize();

async function api(path,method='GET',data){try{return await apiTransport.request(path,method,data);}catch(err){if(err.code==='admin_required'){cloud.admin=false;ui.mode='input';ui.view='sheet';if(cloud.ready){if(!cloud.saving)render();toast(err.message,true);}}throw err;}}





function loginDialog(){showDialog('관리자 모드','<label class="field">비밀번호<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>',async f=>{await api('/auth/login','POST',{password:String(f.get('password'))});cloud.admin=true;ui.mode='admin';ui.view='sheet';dialog.close();if(!cloud.ready)await initialize();else render();},'진입');}
async function logoutAdmin(){try{await api('/auth/logout','POST',{});cloud.admin=false;ui.mode='input';ui.view='sheet';render();}catch(err){toast(err.message,true);}}
function accessPasswordDialog(){
  if(!cloud.admin)throw new Error('관리자 모드에서 변경하세요.');
  showDialog('접속 비밀번호 변경','<p>모든 교사가 함께 사용하는 접속 비밀번호를 변경합니다. 기존 접속은 다음 요청부터 새 비밀번호로 다시 로그인해야 합니다. 현재 관리자의 접속은 유지됩니다.</p><label class="field spaced">현재 관리자 비밀번호<input name="current" type="password" autocomplete="current-password" maxlength="128" required></label><label class="field spaced">새 접속 비밀번호<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><label class="field spaced">새 비밀번호 확인<input name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>',async(f,form)=>{
    const password=String(f.get('password'));
    if(password!==f.get('confirm'))throw new Error('새 비밀번호가 일치하지 않습니다.');
    if(password.length<8||password.length>128)throw new Error('접속 비밀번호는 8자 이상 128자 이하로 입력하세요.');
    const button=form?.querySelector?.('button[type="submit"]');if(button)button.disabled=true;
    try{
      await api('/access/password','POST',{current:String(f.get('current')),password});
      dialog.close();toast('접속 비밀번호를 변경했습니다.');
    }finally{if(button)button.disabled=false;}
  },'비밀번호 변경');
}

function passwordDialog(){showDialog('관리자 비밀번호 변경','<label class="field">현재 비밀번호<input name="current" type="password" autocomplete="current-password" required></label><label class="field spaced">새 비밀번호<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><label class="field spaced">새 비밀번호 확인<input name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>',async f=>{if(f.get('password')!==f.get('confirm'))throw new Error('새 비밀번호가 일치하지 않습니다.');await api('/auth/password','POST',{current:String(f.get('current')),password:String(f.get('password'))});dialog.close();toast('비밀번호 변경 완료');});}

function applyHighlight(){
  document.querySelectorAll('.active-cell,.active-context-label,.active-context-section,.active-plan-cell').forEach(el=>el.classList.remove('active-cell','active-context-label','active-context-section','active-plan-cell'));
  const label=document.querySelector('.selection-context');if(label)label.textContent='';
  const x=cloud.context;if(!x||ui.view!=='sheet')return;
  const tid=x.teacher||'',cid=x.course||'',col=x.column||'',teacher=tid?state.teachers.find(t=>t.id===tid&&t.deptId===dept().id):null,course=cid?state.courses.find(c=>c.id===cid&&c.deptId===dept().id):null;
  if((tid&&!teacher)||(cid&&!course)||(tid&&cid&&!C.teacherRows(state,tid).some(r=>r.courseId===cid))){cloud.context=null;return;}
  if(course){
    const planRow=document.querySelector(`.plan-table tr.plan-row[data-course="${cid}"]`);
    planRow?.querySelector('.sticky-subject')?.classList.add('active-context-label');
    if(col)planRow?.querySelector(`td[data-plan-column="${col}"]`)?.classList.add('active-plan-cell');
  }
  if(teacher){
    document.querySelector(`.teacher-name-cell[data-teacher="${tid}"]`)?.classList.add('active-context-label');
    if(course)document.querySelector(`.teacher-table tr[data-teacher="${tid}"][data-course="${cid}"] .teacher-subject-cell`)?.classList.add('active-context-label');
  }
  if(col)document.querySelectorAll(`.allocation-table th[data-column="${col}"]`).forEach(el=>el.classList.add('active-context-section'));
  const control=x.planGroup?document.querySelector(`[data-action=edit-group][data-id="${x.planGroup}"]`):x.section?document.querySelector(`[data-edit=allocation][data-teacher="${tid}"][data-section="${x.section}"]`):x.group?document.querySelector(`button[data-id="${x.group}"][data-teacher="${tid}"]`):cid&&col?document.querySelector(`[data-edit=planned][data-course="${cid}"][data-column="${col}"]`):null;
  control?.closest('td')?.classList.add('active-cell');
  if(label)label.textContent=[teacher?.name||(tid?'이름 미입력':''),course?.name||'',col?(/^\d-/.test(col)?col.replace('-','학년 ')+'반':col+' 분반'):''].filter(Boolean).join(' · ');
}

document.addEventListener('pointerdown',event=>expandCatalog(event.target),true);
document.addEventListener('focusin',event=>expandCatalog(event.target));
document.addEventListener('focusout',event=>collapseCatalog(event.target));
document.addEventListener('focusin',event=>highlightControl(event.target));

function applyFrameSize(){
  const canvas=document.querySelector('.sheet-canvas'),plan=document.querySelector('.plan-scroll'),bar=document.querySelector('.frame-resizer');
  if(!canvas||!plan||!bar)return;
  const height=canvas.getBoundingClientRect().height;if(!Number.isFinite(height)||height<=0)return;
  const available=Math.max(0,height-bar.getBoundingClientRect().height),min=Math.min(72,available/2)/height*100,max=(available-Math.min(96,available/2))/height*100;
  let ratio;if(frameRatio===null){plan.style.flex='';plan.style.minHeight='';plan.style.maxHeight='';ratio=plan.getBoundingClientRect().height/height*100;}
  else{ratio=Math.min(max,Math.max(min,frameRatio));plan.style.flex=`0 0 ${ratio}%`;plan.style.minHeight='0';plan.style.maxHeight='none';}
  const current=Math.min(max,Math.max(min,ratio));bar.setAttribute('aria-valuemin',min.toFixed(1));bar.setAttribute('aria-valuemax',max.toFixed(1));bar.setAttribute('aria-valuenow',current.toFixed(1));bar.setAttribute('aria-valuetext',`개설 과목 영역 ${Math.round(current)}%`);
  return {canvas,plan,bar,height,min,max,ratio:current};
}
function rememberFrameSize(){try{if(frameRatio===null)localStorage.removeItem(FRAME_KEY);else localStorage.setItem(FRAME_KEY,String(frameRatio));}catch{}}
function resizeFrames(value,remember=false){if(!Number.isFinite(value))return;frameRatio=value;const result=applyFrameSize();if(result)frameRatio=result.ratio;if(remember)rememberFrameSize();applyHighlight();}
function resetFrameSize(){frameRatio=null;rememberFrameSize();applyFrameSize();applyHighlight();}
function finishFrameResize(event){
  if(!frameDrag||event.pointerId!==frameDrag.pointerId)return;
  const {bar,canvas,pointerId}=frameDrag;frameDrag=null;canvas.classList.remove('resizing-frames');
  try{bar.releasePointerCapture?.(pointerId);}catch{}rememberFrameSize();
}
document.addEventListener('pointerdown',event=>{
  const bar=event.target.closest?.('[data-resize="frames"]');if(bar?.dataset.resize!=='frames'||event.button!==0||frameDrag)return;
  const bounds=applyFrameSize();if(!bounds)return;
  event.preventDefault();bar.focus({preventScroll:true});frameDrag={...bounds,bar,pointerId:event.pointerId,startY:event.clientY,startHeight:bounds.plan.getBoundingClientRect().height};bounds.canvas.classList.add('resizing-frames');
  try{bar.setPointerCapture?.(event.pointerId);}catch{}
});
document.addEventListener('pointermove',event=>{if(!frameDrag||event.pointerId!==frameDrag.pointerId)return;event.preventDefault();resizeFrames((frameDrag.startHeight+event.clientY-frameDrag.startY)/frameDrag.height*100);});
document.addEventListener('pointerup',finishFrameResize);
document.addEventListener('pointercancel',finishFrameResize);
document.addEventListener('keydown',event=>{
  if(event.target.dataset.resize!=='frames')return;
  if(event.key==='Enter'){event.preventDefault();resetFrameSize();return;}
  if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  const bounds=applyFrameSize();if(!bounds)return;event.preventDefault();
  const step=event.shiftKey?10:2,value=event.key==='Home'?bounds.min:event.key==='End'?bounds.max:bounds.ratio+(event.key==='ArrowUp'?-step:step);resizeFrames(value,true);
});
document.addEventListener('dblclick',event=>{if(event.target.closest?.('[data-resize="frames"]')?.dataset.resize==='frames')resetFrameSize();});
window.addEventListener('resize',()=>{applyFrameSize();alignHorizontalScroll();applyHighlight();});

async function printBlankForm(){
  if(ui.printing||!cloud.ready||cloud.loading||cloud.saving)return;
  const deptId=dept().id;ui.printing=true;render();
  try{const latest=await api('/workspace','GET',{departmentId:deptId});const printState=C.assertState(latest.partial?stateFromParts(latest.global,latest.parts.map(p=>p.department),latest.parts):latest.state);document.querySelector('#print-root').innerHTML=P.blankFormSvg(printState,deptId);await document.fonts?.ready;window.print();}
  catch(err){toast(err.message,true);}finally{ui.printing=false;render();}
}

function currentPrintSnapshot(){
  const active=document.activeElement;
  if(active?.closest?.('.allocation-table')&&active.dataset.edit&&!commitField(active))throw new Error('입력값을 확인한 뒤 인쇄하세요.');
  flushInputPaint();return C.assertState(C.clone(state));
}
async function printCurrentForm(){
  if(ui.printing||!cloud.ready||cloud.saving||cloud.loading)return;
  if(ui.printCommitFailed){ui.printCommitFailed=false;toast('입력값을 확인한 뒤 인쇄하세요.',true);return;}
  let snapshot,deptId,unsaved;
  try{snapshot=currentPrintSnapshot();deptId=dept().id;unsaved=cloud.globalDirty||cloud.dirty.has(deptId);}
  catch(err){toast(err.message,true);return;}
  ui.printing=true;render();
  try{document.querySelector('#print-root').innerHTML=P.currentFormSvg(snapshot,deptId,unsaved);await document.fonts?.ready;window.print();}
  catch(err){toast(err.message,true);}finally{ui.printing=false;render();}
}
window.addEventListener('beforeprint',()=>{
  if(ui.printing||!cloud.ready||cloud.loading||cloud.saving)return;
  try{const snapshot=currentPrintSnapshot();document.querySelector('#print-root').innerHTML=P.currentFormSvg(snapshot,dept().id,cloud.globalDirty||cloud.dirty.has(dept().id));}
  catch(err){document.querySelector('#print-root').innerHTML='<p>입력값을 확인한 뒤 인쇄하세요.</p>';toast(err.message,true);}
});


})().catch(error=>{document.querySelector("#app").textContent="배당표를 열지 못했습니다: "+error.message;});
