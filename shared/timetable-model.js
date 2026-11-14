import {coursesOf, groupsOf, normalizeName, sum, validate} from './domain.js';

export function exportSolverModel(state, {exportedAt} = {}) {
  const errors=[], warnings=[], bans=[], blocks=[], lengths=new Map();
  const departments=new Map(state.departments.map(d=>[d.id,d]));
  const teachers=new Map(state.teachers.map(t=>[t.id,t]));
  const sections=new Map(), names=new Set();
  const error=(location,message)=>errors.push(`${location}: ${message}`);
  for(const t of state.teachers){
    const location=`${departments.get(t.deptId)?.name ?? t.deptId} / 교사 ${t.id}`;
    const name=normalizeName(t.name);
    if(!name)error(location,'교사명을 입력하세요.');
    else if(names.has(name))error(location,'이름이 같은 교사가 있습니다. 구분명을 입력하세요.');
    names.add(name);
  }
  for(const d of state.departments){
    const courses=coursesOf(state,d.id), groups=courses.flatMap(c=>groupsOf(state,c.id));
    const ids=new Set(groups.flatMap(g=>g.slots.map(s=>s.id)));
    if(d.status!=='locked'&&(groups.some(g=>g.slots.some(s=>s.hours>0)||g.legacy.length)||state.assignments.some(a=>ids.has(a.sectionId))||state.unmapped.some(u=>u.deptId===d.id)))error(d.name,'시수가 있는 교과군을 먼저 확정하세요.');
    for(const issue of validate(state,d.id))error(d.name,`${issue.title} — ${issue.detail}`);
    for(const c of courses)for(const g of groupsOf(state,c.id)){
      const location=`${d.name} / ${c.name} / ${g.label}`;
      if(![1,2,3].includes(c.grade))error(location,'학년은 1~3이어야 합니다.');
      if(g.legacy.length)error(location,'합산 배정을 실제 분반으로 나누세요.');
      if(g.kind==='homeroom'&&!new RegExp(`^${c.grade}-[1-9][0-9]*$`).test(g.label))error(location,'원반 라벨은 학년-반 형식이어야 합니다.');
      if(g.kind==='moving'&&!new RegExp(`^${c.grade}[A-Z]+$`).test(g.label))error(location,'블록 라벨을 확인하세요.');
      if(!['homeroom','moving'].includes(g.kind))error(location,'분반 유형을 확인하세요.');
      for(const s of g.slots){
        if(!Number.isInteger(s.hours)||s.hours<=0)error(`${location} / ${s.label}`,'분반 시수는 양의 정수여야 합니다.');
        sections.set(s.id,{c,g,s,d,location:`${location} / ${s.label}`});
      }
      if(g.kind==='moving')lengths.set(g.label,Math.max(lengths.get(g.label)??0,...g.slots.map(s=>s.hours)));
    }
  }
  for(const u of state.unmapped)error(`${departments.get(u.deptId)?.name ?? u.deptId} / ${u.sourceName} / ${u.label}`,'미연결 배정을 먼저 연결하세요.');
  for(const a of state.assignments){
    const section=sections.get(a.sectionId), teacher=teachers.get(a.teacherId);
    if(!section||!teacher){error(`배당 ${a.sectionId} / ${a.teacherId}`,'배당 참조를 확인하세요.');continue;}
    const {c,g,s,d,location}=section;
    if(!Number.isInteger(a.hours)||a.hours<=0)error(location,'배당 시수는 양의 정수여야 합니다.');
    if(teacher.deptId!==c.deptId)error(location,'교사의 교과군이 일치하지 않습니다.');
    const row={grade:String(c.grade),subject:c.name,teacher:teacher.name,hours:a.hours,
      rowId:`${s.id}:${teacher.id}`,teacherId:teacher.id,courseId:c.id,sectionId:s.id};
    if(g.kind==='homeroom')bans.push({...row,cls:g.label.split('-')[1],art:d.name==='미술'});
    else if(g.kind==='moving')blocks.push({...row,block:g.label,blockLen:lengths.get(g.label),div:s.label});
  }
  for(const [block,len] of lengths){
    const rows=blocks.filter(r=>r.block===block);
    for(const teacherId of new Set(rows.map(r=>r.teacherId))){
      const owned=rows.filter(r=>r.teacherId===teacherId);
      if(sum(owned.map(r=>r.hours))>len){
        const section=sections.get(owned[0].sectionId);
        error(section.location,`블록 내 교사 배당 합이 블록 길이 ${len}시간을 초과합니다.`);
      }
    }
  }
  for(const cfg of state.school.grades)for(let cls=1;cls<=cfg.classCount;cls++){
    const grade=String(cfg.grade), total=sum(bans.filter(r=>r.grade===grade&&r.cls===String(cls)).map(r=>r.hours))+
      sum([...lengths].filter(([block])=>block.startsWith(grade)).map(([,len])=>len));
    if(total!==31)error(`${grade}-${cls}`,`학급 주간 합 ${total}시간이 31시간과 다릅니다.`);
  }
  if(errors.length)return {model:null,errors:[...new Set(errors)],warnings};
  const assignedTeacherIds=new Set([...bans,...blocks].filter(r=>r.hours>0).map(r=>r.teacherId));
  const activeTeachers=state.teachers.filter(t=>assignedTeacherIds.has(t.id));
  for(const t of state.teachers)if(!assignedTeacherIds.has(t.id))warnings.push(`${departments.get(t.deptId)?.name ?? t.deptId} / 교사 ${t.id}: 배당 시수가 없어 모델에서 제외했습니다.`);
  const subjects=new Set([...blocks,...bans].map(r=>r.subject));
  const dependents=[
    {subject:'스포츠과학',follows:['음악감상과비평(2학년)','미술감상과비평(2학년)']},
    {subject:'공강(3학년)',follows:['운동과건강(3학년)']},
  ].filter(d=>subjects.has(d.subject)).map(d=>({...d,follows:d.follows.filter(s=>subjects.has(s))})).filter(d=>d.follows.length);
  return {errors,warnings,model:{
    _type:'시간표_솔버모델',_version:1,
    week:{days:['월','화','수','목','금'],periodsByDay:{0:[2,3,4,5,6,7],1:[1,2,3,4,5,6,7],2:[1,2,3,4],3:[1,2,3,4,5,6,7],4:[1,2,3,4,5,6,7]}},
    rtMap:{1:[1,2,3,4,6,7,8],2:[1,2,3,4,6,7,8],3:[1,2,3,5,6,7,8]},
    lunch:{note:'rt4=1·2학년 4교시, rt5=3학년 4교시',amEndRT:4,pmStartRT3:5},
    teachers:activeTeachers.map(t=>t.name),buja:activeTeachers.filter(t=>t.isLead).map(t=>t.name),gangsa:activeTeachers.filter(t=>t.name.includes('강사')).map(t=>t.name),
    teacherTotal:Object.fromEntries(activeTeachers.map(t=>[t.name,sum([...bans,...blocks].filter(r=>r.teacherId===t.id).map(r=>r.hours))])),
    flags:[],bans,blocks,
    options:{weights:{over4:1,run3:1,lunch:1,firstlast:1},artBlock:true,noLunchBlock:true,spread:true,coverage:false,
      coverageSubjects:[...new Set(blocks.map(r=>r.subject))].filter(s=>/음악 감상과 비평|미술 감상과 비평/.test(s)),
      dependents,pairAllowList:[],gangsaDayCount:{},bujaFridayP1Forbidden:true},
    source:{term:`${state.school.year}-${state.school.semester}`,departmentRevisions:{...(state.departmentRevisions??{})},exportedAt:exportedAt??null},
    classes:Object.fromEntries(state.school.grades.map(g=>[g.grade,g.classCount])),
  }};
}
