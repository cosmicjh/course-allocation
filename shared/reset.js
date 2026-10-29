import * as C from "./domain.js";
function apply(original,scope,deptId){
  if(!['hours','department','all'].includes(scope))throw new Error('초기화 범위를 선택하세요.');
  const next=C.clone(original);C.assertState(next);
  if(!next.departments.some(d=>d.id===deptId))throw new Error('초기화할 교과군을 찾을 수 없습니다.');
  const ids=new Set(scope==='all'?next.departments.map(d=>d.id):[deptId]),courses=next.courses.filter(c=>ids.has(c.deptId)),cids=new Set(courses.map(c=>c.id)),groups=next.groups.filter(g=>cids.has(g.courseId)),slots=new Set(groups.flatMap(g=>g.slots.map(s=>s.id)));
  const hours=C.sum(next.assignments.filter(a=>slots.has(a.sectionId)).map(a=>a.hours))+C.sum(groups.flatMap(g=>g.legacy).map(a=>a.hours))+C.sum(next.unmapped.filter(u=>ids.has(u.deptId)).map(u=>u.hours));
  const teacherCount=next.teachers.filter(t=>ids.has(t.deptId)).length;
  next.assignments=next.assignments.filter(a=>!slots.has(a.sectionId));next.unmapped=next.unmapped.filter(u=>!ids.has(u.deptId));
  if(scope==='hours'){for(const g of groups)g.legacy=[];}
  else{
    next.teachers=next.teachers.filter(t=>!ids.has(t.deptId));next.courses=next.courses.filter(c=>!ids.has(c.deptId));next.groups=next.groups.filter(g=>!cids.has(g.courseId));
    for(const d of next.departments.filter(d=>ids.has(d.id))){d.sourceTotal=null;d.note='';}
  }
  for(const d of next.departments.filter(d=>ids.has(d.id)))d.status='draft';
  if(scope==='all')next.source={};
  C.assertState(next);return {state:next,departmentIds:[...ids],courseCount:courses.length,teacherCount,hours};
}
export {apply};
