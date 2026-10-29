import * as C from '../shared/domain.js';
import * as S from '../shared/state.js';
export function fail(status, code, message) { throw Object.assign(new Error(message), {status, code}); }
export const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function boundedJson(value, label) {
  const json = JSON.stringify(value);
  if (!json || new TextEncoder().encode(json).length > 1500000) fail(413,'too_large',`${label}가 너무 큽니다. 교과군을 나누어 저장하세요.`);
  return json;
}
export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail(400,'invalid_revision','저장 버전을 확인하세요.');
  return value;
}
export function operationId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail(400,'invalid_operation','저장 작업 식별자가 올바르지 않습니다.');
  return value;
}
export function assemble(global, parts, history=[]) {
  return {schemaVersion:1,uiVersion:3,school:global.school,source:global.source??{},customCatalog:global.customCatalog??[],
    departments:parts.map(p=>p.department),teachers:parts.flatMap(p=>p.teachers),courses:parts.flatMap(p=>p.courses),
    groups:parts.flatMap(p=>p.groups),assignments:parts.flatMap(p=>p.assignments),unmapped:parts.flatMap(p=>p.unmapped),history};
}
export function validatePart(global, part, id) {
  if (!part || part.department?.id !== id || !global.departmentIds.includes(id)) fail(400,'invalid_part','교과군 정보가 일치하지 않습니다.');
  try { C.assertState(assemble(global,[part])); } catch (e) { fail(400,'invalid_state',e.message); }
  boundedJson(part,'교과군 자료');
}
export function validateGlobal(global, parts) {
  if (!global || global.schemaVersion!==1 || !Array.isArray(global.departmentIds) || !global.departmentIds.length || global.departmentIds.length>100 ||
      new Set(global.departmentIds).size!==global.departmentIds.length || parts.length!==global.departmentIds.length ||
      global.departmentIds.some((id,i)=>parts[i]?.department.id!==id)) fail(400,'invalid_global','학교 설정과 교과군 목록을 확인하세요.');
  try { C.assertState(assemble(global,parts)); } catch(e) { fail(400,'invalid_state',e.message); }
  boundedJson(global,'학교 설정');
}
export function authorizePart(global, before, after, admin) {
  const oldStatus=before.department.status,newStatus=after.department.status;
  const withoutStatus=p=>({...p,department:{...p.department,status:'draft'}});
  if(oldStatus!=='draft' && !(admin && newStatus==='draft') && !equal(withoutStatus(before),withoutStatus(after)))
    fail(403,'sheet_locked','제출·확정된 배당표입니다. 관리자에서 입력을 다시 열어 주세요.');
  if(oldStatus!==newStatus){
    const allowed=(oldStatus==='draft'&&newStatus==='submitted') || (admin&&oldStatus==='submitted'&&newStatus==='locked') || (admin&&newStatus==='draft');
    if(!allowed)fail(403,'admin_required','배당표 상태 변경 권한이 없습니다.');
    if(newStatus!=='draft' && C.validate(assemble(global,[after]),after.department.id).length)
      fail(400,'validation_failed','검증 항목을 모두 해결한 후 제출·확정하세요.');
  }
  if(admin)return;
  if(!equal({...before.department,status:newStatus},after.department))
    fail(403,'admin_required','과목·교과군 설정은 관리자 모드에서 변경하세요.');
  // Input users may redistribute legacy allocations or delete a teacher's subject row,
  // but may not create/change section plans, import metadata, or legacy hour totals.
  if(before.groups.length!==after.groups.length)fail(403,'admin_required','분반 설정은 관리자 모드에서 변경하세요.');
  for(let i=0;i<before.groups.length;i++){
    const a=before.groups[i],b=after.groups[i];
    if(!equal({...a,legacy:[]},{...b,legacy:[]}))fail(403,'admin_required','분반 설정은 관리자 모드에서 변경하세요.');
    for(const entry of b.legacy)if(!a.legacy.some(x=>equal(x,entry)))fail(403,'admin_required','합산 배정 원본을 변경할 수 없습니다.');
    if(a.legacy.length && !equal(a.legacy,b.legacy)){
      for(const entry of a.legacy){
        const remaining=b.legacy.filter(x=>x.teacherId===entry.teacherId).reduce((n,x)=>n+x.hours,0);
        const assigned=after.assignments.filter(x=>x.teacherId===entry.teacherId&&a.slots.some(s=>s.id===x.sectionId)).reduce((n,x)=>n+x.hours,0);
        const rowStillPresent=after.teachers.find(t=>t.id===entry.teacherId)?.rows?.some(r=>r.courseId===a.courseId);
        if(remaining+assigned!==a.legacy.filter(x=>x.teacherId===entry.teacherId).reduce((n,x)=>n+x.hours,0) && rowStillPresent)
          fail(403,'admin_required','합산 배정은 원본 교사별 시수를 유지하여 나누세요.');
      }
    }
  }
  const trial=assemble(global,[C.clone(before)]);
  if(!equal(before.unmapped,after.unmapped)){
    for(const name of new Set(before.unmapped.map(u=>u.sourceName))){
      const old=before.unmapped.filter(u=>u.sourceName===name),left=after.unmapped.filter(u=>u.sourceName===name);
      if(equal(old,left))continue;
      if(left.length)fail(403,'admin_required','미연결 원본을 임의로 변경할 수 없습니다.');
      const course=after.courses.find(c=>c.aliases?.includes(name));
      if(!course)fail(403,'admin_required','과목 연결 정보를 확인하세요.');
      C.mapSourceName(trial,after.department.id,name,course.id);
    }
    if(!equal(S.departmentPart(trial,after.department.id).unmapped,after.unmapped))fail(403,'admin_required','미연결 원본을 변경할 수 없습니다.');
  }
  if(!equal(trial.courses,after.courses))fail(403,'admin_required','과목 설정은 관리자 모드에서 변경하세요.');
}
