import * as C from "./domain.js";
import * as R from "./catalog.js";
const norm=v=>C.normalizeName(v).replace(/[·⋅ㆍ]/g,'·');
function text(v,label,max=2000){if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(label+'을 확인하세요.');return v.trim();}
function number(v,label,min,max){if(typeof v!=='number'||!Number.isInteger(v)||v<min||v>max)throw new Error(label+'을 확인하세요.');return v;}
function unique(rows,key,label){if(new Set(rows.map(x=>x[key])).size!==rows.length)throw new Error(label+'이 중복되었습니다.');}
function parse(raw){
  if(!raw||raw.format!=='school-course-hours'||raw.schemaVersion!==1)throw new Error('분반배정도구 v19의 시수배당용 JSON 파일을 선택하세요.');
  if(raw.hoursUnit!=='weekly-periods'||raw.includesStudentData!==false)throw new Error('주당 시수 단위와 학생정보 제외 여부를 확인하세요.');
  if(!Array.isArray(raw.sheets)||!raw.sheets.length||raw.sheets.length>30)throw new Error('가져올 시트 목록을 확인하세요.');
  const sheets=raw.sheets.map(s=>{
    if(!s.validation||s.validation.complete!==true||s.validation.hardConstraintsPassed!==true||s.validation.coupledCohortsPassed!==true)throw new Error('완전배정 검증을 통과한 결과만 가져올 수 있습니다.');
    if(!Array.isArray(s.courses)||!s.courses.length||s.courses.length>300)throw new Error('시트의 과목 목록을 확인하세요.');
    const courses=s.courses.map(c=>{
      if(!Array.isArray(c.sections)||!c.sections.length||c.sections.length>312)throw new Error('과목의 실제 분반 목록을 확인하세요.');
      const sections=c.sections.map(a=>({id:text(a.sectionId,'분반 식별자'),code:text(a.sectionCode,'실제 분반 코드',20),block:text(a.timeBlock,'이동수업 코드',20),hours:number(a.weeklyHours,'분반별 주당 시수',1,40),cohortId:a.cohortId==null?null:text(a.cohortId,'결합 식별자')}));
      unique(sections,'id','분반 식별자');unique(sections,'code','실제 분반 코드');
      if(c.sectionCount!==sections.length||c.totalWeeklyHours!==C.sum(sections.map(a=>a.hours)))throw new Error(c.courseName+': 분반 수 또는 총시수가 일치하지 않습니다.');
      return {id:text(c.courseId,'과목 식별자'),name:text(c.courseName,'과목명',100),subjectGroup:typeof c.subjectGroup==='string'?c.subjectGroup:'',credits:c.credits==null?null:number(c.credits,'학점',1,20),hours:number(c.weeklyHours,'과목별 주당 시수',1,40),sections};
    });
    unique(courses,'id','과목 식별자');const all=courses.flatMap(c=>c.sections);unique(all,'id','시트 내 분반 식별자');
    if(!Array.isArray(s.coupledCohorts))throw new Error('2+1 결합 정보를 확인하세요.');
    const used=new Set(),links=s.coupledCohorts.map(l=>{
      const id=text(l.cohortId,'결합 식별자');
      if(l.sameStudents!==true||!Array.isArray(l.sectionIds)||l.sectionIds.length!==2||l.sectionIds[0]===l.sectionIds[1])throw new Error('동일 학생 결합 정보를 확인하세요.');
      const members=l.sectionIds.map(sid=>all.find(a=>a.id===sid));
      if(members.some(a=>!a)||members.some(a=>a.cohortId!==id)||members[0].block!==members[1].block||members[0].code!==members[1].code||members.some(a=>used.has(a.id)))throw new Error('결합 과목의 실제 분반 연결이 일치하지 않습니다.');
      members.forEach(a=>used.add(a.id));return {id,sectionIds:members.map(a=>a.id)};
    });
    unique(links,'id','결합 식별자');if(all.some(a=>a.cohortId&&!used.has(a.id)))throw new Error('연결되지 않은 결합 분반이 있습니다.');
    if(s.totals&&(s.totals.courseCount!==courses.length||s.totals.sectionCount!==all.length||s.totals.totalWeeklyHours!==C.sum(all.map(a=>a.hours))))throw new Error('시트 합계가 실제 분반 정보와 일치하지 않습니다.');
    return {id:text(s.sheetId,'시트 식별자'),name:text(s.sourceSheetName,'시트명',100),grade:s.grade==null?null:number(s.grade,'대상 학년',1,3),year:s.academicYear==null?null:number(s.academicYear,'학년도',2000,2100),semester:s.semester==null?null:number(s.semester,'학기',1,2),courses,links};
  });
  unique(sheets,'id','시트 식별자');
  return {sheets,exportedAt:typeof raw.exportedAt==='string'?raw.exportedAt:'',toolVersion:typeof raw.source?.toolVersion==='string'?raw.source.toolVersion:''};
}
function canonical(section,grade){
  const block=section.block.trim().toUpperCase().match(/^([123])?([A-Z]{1,2})$/),code=section.code.trim().toUpperCase().match(/^([123])?([A-Z]{1,2})([1-6])?$/);
  if(!block||!code||block[2]!==code[2])throw new Error(section.code+': 이동수업 코드는 A·B 또는 2A·2B 형식이며 하위 분반 번호는 1부터 6까지 지원합니다.');
  if((block[1]&&Number(block[1])!==grade)||(code[1]&&Number(code[1])!==grade))throw new Error(section.code+': 선택한 학년과 코드의 학년이 다릅니다.');
  let index=0;for(const ch of block[2])index=index*26+ch.charCodeAt(0)-64;
  if(index>52)throw new Error('이동수업 코드는 A부터 AZ까지 지원합니다.');
  const parent=grade+block[2];return {parent,label:parent+(code[3]||''),index,hours:section.hours};
}
function defaults(data,state){
  return {year:state.school.year,semester:state.school.semester,clearAssignments:false,sheets:data.sheets.map(sheet=>({include:true,grade:sheet.grade||'',courses:sheet.courses.map(c=>{
    const matches=state.courses.filter(x=>norm(x.name)===norm(c.name)&&(!sheet.grade||x.grade===sheet.grade)),depts=[...new Set(matches.map(x=>x.deptId))];
    const item=R.catalog.find(x=>norm(x.name)===norm(c.name));
    const group=R.groups.find(g=>g.id===item?.groupId||g.id===c.subjectGroup||g.name===c.subjectGroup);
    const candidates=group?state.departments.filter(d=>R.suggestedGroup(d.name)===group.id):[];
    return {include:true,name:matches.length?matches[0].name:c.name,deptName:depts.length===1?state.departments.find(d=>d.id===depts[0]).name:candidates.length===1?candidates[0].name:group?.name||'',hours:c.hours};
  })}))};
}
function plan(data,original,options){
  const next=C.clone(original);C.assertState(next);
  const year=C.integer(options.year,2000,2100),semester=C.integer(options.semester,1,2);
  if((next.school.year!==year||next.school.semester!==semester)&&(next.courses.length||next.groups.length||next.assignments.length))throw new Error('기존 자료의 학년도·학기와 다릅니다. 학교 설정을 먼저 확인하세요.');
  next.school.year=year;next.school.semester=semester;
  const targets=new Map(),sectionTargets=new Map(),selectedLinks=[],newDepartments=[];
  for(let si=0;si<data.sheets.length;si++){
    const sheet=data.sheets[si],option=options.sheets?.[si];if(!option?.include)continue;
    const grade=C.integer(option.grade,1,3);
    if(sheet.grade&&sheet.grade!==grade)throw new Error(sheet.name+': 원본의 대상 학년과 다릅니다.');
    if((sheet.year&&sheet.year!==year)||(sheet.semester&&sheet.semester!==semester))throw new Error(sheet.name+': 원본의 학년도·학기와 다릅니다.');
    for(let ci=0;ci<sheet.courses.length;ci++){
      const source=sheet.courses[ci],choice=option.courses?.[ci];if(!choice?.include)continue;
      const name=text(choice.name,'배당표 과목명',100),deptName=text(choice.deptName,'교과군명',30),hours=C.integer(choice.hours,1,40);
      let department=next.departments.find(d=>norm(d.name)===norm(deptName));
      if(!department){if(next.departments.length>=100)throw new Error('교과군은 100개까지 지원합니다.');department={id:C.uid('d'),name:deptName,status:'draft',sourceTotal:null,note:''};next.departments.push(department);newDepartments.push(department.id);}
      C.assertDraft(next,department.id);
      const matches=next.courses.filter(c=>c.deptId===department.id&&c.grade===grade&&norm(c.name)===norm(name));
      if(matches.length>1)throw new Error(name+': 같은 학년·교과군의 과목명이 중복되어 있습니다.');
      const course=matches[0]||C.addCourse(next,{deptId:department.id,name,grade,baseHours:hours});
      if(course.kind!=='subject')throw new Error(name+': 선택과목에 연결하세요.');
      let target=targets.get(course.id);
      if(!target){target={course,groups:new Map(),oldTotal:C.sum(C.groupsOf(next,course.id).filter(g=>g.kind==='moving').flatMap(g=>g.slots.map(a=>a.hours))),sources:[],credits:source.credits};targets.set(course.id,target);}
      if(target.credits!==source.credits)throw new Error(name+': 같은 과목으로 연결할 원본들의 학점이 다릅니다.');
      target.sources.push(source.id);course.baseHours=hours;course.credits=source.credits;
      for(const section of source.sections){
        const label=canonical(section,grade),cfg=next.school.grades.find(g=>g.grade===grade);cfg.movingCount=Math.max(cfg.movingCount,label.index);
        const effective=hours===source.hours?section.hours:hours;
        let group=target.groups.get(label.parent);if(!group){group={parent:label.parent,grade,slots:[]};target.groups.set(label.parent,group);}
        if(group.slots.some(s=>s.label===label.label))throw new Error(name+' '+label.label+': 여러 원본을 같은 분반으로 중복 연결할 수 없습니다.');
        const slot={label:label.label,hours:effective,sourceSectionId:section.id,sourceSheetId:sheet.id,cohortId:section.cohortId};group.slots.push(slot);
        sectionTargets.set(sheet.id+'\n'+section.id,{courseId:course.id,label:label.label,grade});
      }
    }
    for(const link of sheet.links)selectedLinks.push({sheetId:sheet.id,...link});
  }
  if(!targets.size)throw new Error('가져올 과목을 한 개 이상 선택하세요.');
  let linkCount=0,individualSectionCount=0;
  for(const link of selectedLinks){
    const targets=link.sectionIds.map(id=>sectionTargets.get(link.sheetId+'\n'+id));
    if(!targets.some(Boolean))continue;
    if(targets.some(t=>!t)){individualSectionCount++;continue;}
    if(targets[0].courseId===targets[1].courseId||targets[0].label!==targets[1].label||targets[0].grade!==targets[1].grade)throw new Error('결합 과목은 서로 다른 과목의 동일 학년·분반으로 연결하세요.');
    linkCount++;
  }
  let clearedHours=0;const summary=[];
  for(const target of targets.values()){
    const course=target.course,old=C.groupsOf(next,course.id).filter(g=>g.kind==='moving');
    if(options.clearAssignments===true){
      const ids=new Set(old.flatMap(g=>g.slots.map(s=>s.id)));clearedHours+=C.sum(next.assignments.filter(a=>ids.has(a.sectionId)).map(a=>a.hours))+C.sum(old.flatMap(g=>g.legacy).map(a=>a.hours));
      next.assignments=next.assignments.filter(a=>!ids.has(a.sectionId));for(const g of old)g.legacy=[];
    }
    for(const g of old.filter(g=>!target.groups.has(g.label))){if(g.legacy.length||g.slots.some(s=>C.allocated(next,s.id)))throw new Error(course.name+' '+g.label+': 삭제할 분반에 교사 배정이 있습니다. 기존 배정을 먼저 해제하세요.');C.removeGroup(next,g.id);}
    const groups=[...target.groups.values()].sort((a,b)=>a.parent.localeCompare(b.parent,'en',{numeric:true}));
    for(const g of groups){
      try{const changed=C.setSectionPlan(next,course.id,{grade:course.grade,label:g.parent,kind:'moving'},g.slots);for(const s of changed.slots){const source=g.slots.find(a=>a.label===s.label);s.importRef={sheetId:source.sourceSheetId,sectionId:source.sourceSectionId,cohortId:source.cohortId};}}
      catch(err){throw new Error(course.name+' '+g.parent+': '+err.message);}
    }
    const slots=groups.flatMap(g=>g.slots);summary.push({id:course.id,deptId:course.deptId,department:next.departments.find(d=>d.id===course.deptId).name,name:course.name,grade:course.grade,oldTotal:target.oldTotal,total:C.sum(slots.map(s=>s.hours)),sections:slots.map(s=>({label:s.label,hours:s.hours})),splitCount:groups.filter(g=>g.slots.length>1||g.slots[0].label!==g.parent).length});
  }
  next.source={...next.source,courseHours:{format:'school-course-hours',schemaVersion:1,exportedAt:data.exportedAt,toolVersion:data.toolVersion,linkCount,individualSectionCount}};
  C.assertState(next);
  return {state:next,summary,newDepartments,departmentIds:[...new Set(summary.map(s=>s.deptId))],sectionCount:C.sum(summary.map(s=>s.sections.length)),total:C.sum(summary.map(s=>s.total)),linkCount,individualSectionCount,clearedHours};
}
export {parse,canonical,defaults,plan};
