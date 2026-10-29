const clone = value => JSON.parse(JSON.stringify(value));
const teacherLabel = (teacher, index) => teacher?.name?.trim() || (index === undefined ? '이름 미입력' : `교사 ${index + 1}`);
const normalizeName = value => String(value ?? '').replace(/\s/g, '').replace(/Ⅰ/g,'I').replace(/Ⅱ/g,'II');
function nameHash(value) {let h=2166136261;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
function upgradeState(original, defaultNameHashes={}) {
  const state=clone(original);
  if(state.uiVersion>=2)return state;
  const changed=new Set();
  for(const t of state.teachers??[])if(defaultNameHashes[t.id]&&nameHash(t.name)===defaultNameHashes[t.id]){t.name='';changed.add(t.deptId);}
  for(const d of state.departments??[])if(changed.has(d.id))d.status='draft';
  if(state.customCatalog===null||state.customCatalog===undefined)state.customCatalog=[];state.uiVersion=2;return state;
}
const sum = values => values.reduce((a, b) => a + b, 0);
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const letter = number => { let n = number, s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; };
function integer(value, min = 0, max = 1000) {
  if (value === '' || value === null || !Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`${min}부터 ${max}까지의 정수를 입력하세요.`);
  return Number(value);
}
const coursesOf = (state, deptId) => state.courses.filter(c => !deptId || c.deptId === deptId);
const groupsOf = (state, courseId) => state.groups.filter(g => g.courseId === courseId);
const teachersOf = (state, deptId) => state.teachers.filter(t => !deptId || t.deptId === deptId);
const groupOfSection = (state, sectionId) => state.groups.find(g => g.slots.some(s => s.id === sectionId));
const allocated = (state, sectionId) => sum(state.assignments.filter(a => a.sectionId === sectionId).map(a => a.hours));
const isSplitGroup = group => group.slots.length !== 1 || group.slots[0].label !== group.label;
function teacherHours(state, teacherId) {
  return sum(state.assignments.filter(a => a.teacherId === teacherId).map(a => a.hours)) + sum(state.groups.flatMap(g => g.legacy).filter(a => a.teacherId === teacherId).map(a => a.hours)) + sum(state.unmapped.filter(a => a.teacherId === teacherId).map(a => a.hours));
}
function metrics(state, deptId) {
  const cs = coursesOf(state, deptId), cids = new Set(cs.map(c => c.id));
  const gs = state.groups.filter(g => cids.has(g.courseId)), sids = new Set(gs.flatMap(g => g.slots.map(s => s.id)));
  const planned = sum(gs.flatMap(g => g.slots.map(s => s.hours)));
  const confirmed = sum(state.assignments.filter(a => sids.has(a.sectionId)).map(a => a.hours));
  const pending = sum(gs.flatMap(g => g.legacy.map(a => a.hours)));
  const unmatched = sum(state.unmapped.filter(a => !deptId || a.deptId === deptId).map(a => a.hours));
  return {planned, confirmed, pending, unmatched, remaining: planned - confirmed - pending,
    sectionCount: sids.size, groupCount: gs.length, splitCount: gs.filter(isSplitGroup).length,
    courseCount: cs.length, teacherCount: teachersOf(state, deptId).length,
    splitSectionCount: gs.filter(isSplitGroup).reduce((n,g)=>n+g.slots.length,0)};
}
function assertDraft(state, deptId) {
  const d = state.departments.find(d => d.id === deptId);
  if (!d) throw new Error('교과군을 찾을 수 없습니다.');
  if (d.status !== 'draft') throw new Error('제출·확정된 배당표입니다. 관리자에서 입력을 다시 열어 주세요.');
}
function setAssignment(state, sectionId, teacherId, value) {
  const group = groupOfSection(state, sectionId);
  if (!group) throw new Error('분반을 찾을 수 없습니다.');
  const course = state.courses.find(c => c.id === group.courseId);
  assertDraft(state, course.deptId);
  const teacher = state.teachers.find(t => t.id === teacherId && t.deptId === course.deptId);
  if (!teacher) throw new Error('동일 교과군의 교사를 선택하세요.');
  if (group.legacy.length) throw new Error('원본 합산 배정을 하위 분반에 먼저 나누어 주세요.');
  const hours = integer(value, 0, 40), slot = group.slots.find(s => s.id === sectionId);
  const others = allocated(state, sectionId) - sum(state.assignments.filter(a => a.sectionId === sectionId && a.teacherId === teacherId).map(a => a.hours));
  if (others + hours > slot.hours) throw new Error(`${slot.label}은 총 ${slot.hours}시간입니다. 현재 입력 가능한 시수는 ${slot.hours - others}시간입니다.`);
  state.assignments = state.assignments.filter(a => a.sectionId !== sectionId || a.teacherId !== teacherId);
  if (hours) state.assignments.push({sectionId, teacherId, hours});
}
function rebuildGroup(state, groupId, countValue, childHours, confirmReview = true) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) throw new Error('분반을 찾을 수 없습니다.');
  const course = state.courses.find(c => c.id === group.courseId);
  assertDraft(state, course.deptId);
  const count = integer(countValue, 1, 6), hours = integer(childHours, 1, 40);
  if (group.slots.length === count && group.slots.every(s => s.hours === hours)) {
    if (confirmReview) group.review = false;
    return;
  }
  const ids = new Set(group.slots.map(s => s.id));
  const original = [...group.legacy, ...state.assignments.filter(a => ids.has(a.sectionId))];
  const teachers = new Map();
  for (const a of original) teachers.set(a.teacherId, (teachers.get(a.teacherId) ?? 0) + a.hours);
  if (sum([...teachers.values()]) > count * hours) throw new Error('현재 교사 배정량보다 총 시수가 작습니다. 먼저 입력모드에서 배정량을 줄여 주세요.');
  state.assignments = state.assignments.filter(a => !ids.has(a.sectionId));
  group.slots = Array.from({length: count}, (_, i) => ({id: uid('s'), label: count === 1 ? group.label : `${group.label}${i+1}`, hours}));
  group.legacy = [];
  if (count > 1) group.legacy = [...teachers].map(([teacherId, hours]) => ({teacherId, hours}));
  else for (const [teacherId, hours] of teachers) state.assignments.push({sectionId: group.slots[0].id, teacherId, hours});
  if (confirmReview) group.review = false;
}
function groupPlan(group) {
  const count=group.slots.length,total=sum(group.slots.map(s=>s.hours)),uniform=group.slots.every(s=>s.hours===group.slots[0].hours);
  return {count,total,hours:uniform?group.slots[0].hours:null,label:group.slots.map(s=>`${s.label} ${s.hours}시간`).join(' · ')};
}
function sectionPlan(parent,sections) {
  if(!Array.isArray(sections)||!sections.length||sections.length>6)throw new Error('실제 분반을 1개부터 6개까지 선택하세요.');
  const labels=new Set(sections.map(s=>s.label));
  if(labels.size!==sections.length)throw new Error('하위 분반명이 중복되었습니다.');
  const allowed=new Set(Array.from({length:6},(_,i)=>parent+(i+1)));
  if(!(sections.length===1&&sections[0].label===parent)&&sections.some(s=>!allowed.has(s.label)))throw new Error('분반명이 올바르지 않습니다. 상위 분반과 하위 분반을 함께 개설할 수 없습니다.');
  return sections.map(s=>({label:s.label,hours:integer(s.hours,1,40)})).sort((a,b)=>a.label.localeCompare(b.label,'en',{numeric:true}));
}
function setSectionPlan(state,courseId,column,sections) {
  const next=clone(state),c=next.courses.find(c=>c.id===courseId);
  if(!c)throw new Error('과목을 찾을 수 없습니다.');assertDraft(next,c.deptId);
  if(!column||column.grade!==c.grade)throw new Error('해당 학년의 분반을 선택하세요.');
  const plan=sectionPlan(column.label,sections),total=sum(plan.map(s=>s.hours));
  let g=groupsOf(next,courseId).find(g=>g.label===column.label);
  if(!g)g=addGroup(next,courseId,column.label,column.kind,plan[0].hours);
  const oldSlots=g.slots,ids=new Set(oldSlots.map(s=>s.id)),split=!(plan.length===1&&plan[0].label===g.label);
  if(!isSplitGroup(g)&&split&&!g.legacy.length){
    const owners=new Map();for(const a of next.assignments.filter(a=>ids.has(a.sectionId)))owners.set(a.teacherId,(owners.get(a.teacherId)??0)+a.hours);
    if(sum([...owners.values()])>total)throw new Error('현재 교사 배정량보다 총 시수가 작습니다. 먼저 담당 시수를 줄여 주세요.');
    next.assignments=next.assignments.filter(a=>!ids.has(a.sectionId));g.legacy=[...owners].map(([teacherId,hours])=>({teacherId,hours}));
  }else if(!g.legacy.length){
    if(oldSlots.some(s=>!plan.some(p=>p.label===s.label)&&allocated(next,s.id)>0))throw new Error('삭제할 하위 분반에 배정이 있습니다. 먼저 담당 시수를 해제하세요.');
    if(oldSlots.some(s=>{const p=plan.find(p=>p.label===s.label);return p&&allocated(next,s.id)>p.hours;}))throw new Error('분반별 배정 시수보다 줄일 수 없습니다.');
  }
  if(sum(g.legacy.map(a=>a.hours))>total)throw new Error('현재 교사 배정량보다 총 시수가 작습니다. 먼저 담당 시수를 줄여 주세요.');
  g.slots=plan.map(p=>({id:oldSlots.find(s=>s.label===p.label)?.id??uid('s'),...p}));g.review=false;
  if(!split&&g.legacy.length){const owners=new Map();for(const a of g.legacy)owners.set(a.teacherId,(owners.get(a.teacherId)??0)+a.hours);next.assignments.push(...[...owners].map(([teacherId,hours])=>({teacherId,sectionId:g.slots[0].id,hours})));g.legacy=[];}
  assertState(next);state.groups=next.groups;state.assignments=next.assignments;
  return state.groups.find(x=>x.id===g.id);
}
function setGroupPlan(state,courseId,column,countValue,hoursValue) {
  const count=integer(countValue,1,6),hours=integer(hoursValue,1,40);
  return setSectionPlan(state,courseId,column,Array.from({length:count},(_,i)=>({label:count===1?column.label:column.label+(i+1),hours})));
}
function resolvePool(state, groupId, proposed) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group?.legacy.length) throw new Error('분리 대기 중인 원본 배정이 없습니다.');
  assertDraft(state, state.courses.find(c => c.id === group.courseId).deptId);
  const sids = new Set(group.slots.map(s => s.id)), totals = new Map(), seen = new Set();
  const valid = proposed.map(a => ({teacherId: a.teacherId, sectionId: a.sectionId, hours: integer(a.hours, 0, 40)}));
  for (const a of valid) {
    if (!sids.has(a.sectionId) || !group.legacy.some(p => p.teacherId === a.teacherId)) throw new Error('원본 배정의 교사와 하위 분반만 지정할 수 있습니다.');
    const key = `${a.teacherId}:${a.sectionId}`;
    if (seen.has(key)) throw new Error('중복 배정입니다.');
    seen.add(key); totals.set(a.teacherId, (totals.get(a.teacherId) ?? 0) + a.hours);
  }
  for (const teacherId of new Set(group.legacy.map(a => a.teacherId))) {
    const original = sum(group.legacy.filter(a => a.teacherId === teacherId).map(a => a.hours));
    if ((totals.get(teacherId) ?? 0) !== original) throw new Error('교사별 원본 합계를 유지하여 나누어 주세요.');
  }
  for (const slot of group.slots) if (sum(valid.filter(a => a.sectionId === slot.id).map(a => a.hours)) + allocated(state, slot.id) > slot.hours) throw new Error(`${slot.label}의 필요 시수 ${slot.hours}시간을 초과했습니다.`);
  state.assignments.push(...valid.filter(a => a.hours > 0));
  group.legacy = [];
}
function mapSourceName(state, deptId, sourceName, targetCourseId) {
  assertDraft(state, deptId);
  const course = state.courses.find(c => c.id === targetCourseId && c.deptId === deptId);
  if (!course) throw new Error('연결할 과목을 선택하세요.');
  const records = state.unmapped.filter(a => a.deptId === deptId && a.sourceName === sourceName);
  const next = clone(state);
  for (const a of records) {
    if (a.grade !== course.grade) throw new Error('학년이 일치하는 과목을 선택하세요.');
    const group = groupsOf(next, course.id).find(g => g.label === a.label);
    if (!group || isSplitGroup(group)) throw new Error(`${a.label}은 단일 분반으로 연결할 수 없습니다.`);
    const sid = group.slots[0].id;
    const current = sum(next.assignments.filter(x => x.sectionId === sid && x.teacherId === a.teacherId).map(x => x.hours));
    setAssignment(next, sid, a.teacherId, current + a.hours);
  }
  state.assignments = next.assignments;
  state.unmapped = state.unmapped.filter(a => !(a.deptId === deptId && a.sourceName === sourceName));
  course.aliases = [...new Set([...(course.aliases ?? []), sourceName])];
}
function validate(state, deptId) {
  const issues = [], cs = coursesOf(state, deptId);
  for(const t of teachersOf(state,deptId))if(!t.name.trim()&&teacherHours(state,t.id)>0)issues.push({type:'teacher',deptId:t.deptId,teacherId:t.id,title:'교사명 미입력',detail:`${teacherHours(state,t.id)}시간이 배정된 교사 행의 이름을 입력하세요.`});
  for (const c of cs) {
    const gs=groupsOf(state,c.id);
    if (!gs.length) issues.push({type:'empty',deptId:c.deptId,courseId:c.id,title:`${c.name}: 분반 없음`,detail:'수업할 학급 또는 이동 분반을 추가하세요.'});
    for (const g of gs) {
      if (g.review) issues.push({type:'structure',deptId:c.deptId,courseId:c.id,groupId:g.id,title:`${c.name} ${g.label}: 분반 구조 확인`,detail:`원본 ${g.sourceHours}시간. 실제 하위 분반 수와 분반별 시수를 확인하세요.`});
      if (g.legacy.length) issues.push({type:'pool',deptId:c.deptId,courseId:c.id,groupId:g.id,title:`${c.name} ${g.label}: 하위 분반 배정 대기`,detail:`원본 합계 ${sum(g.legacy.map(a=>a.hours))}시간을 ${g.slots.map(s=>s.label).join(', ')}에 나누어 주세요.`});
      for (const s of g.slots) {
        if (g.legacy.length) continue;
        const delta = s.hours - allocated(state,s.id);
        if (delta !== 0) issues.push({type:delta<0?'over':'missing',deptId:c.deptId,courseId:c.id,groupId:g.id,title:`${c.name} ${s.label}: ${Math.abs(delta)}시간 ${delta<0?'초과':'미배분'}`,detail:`필요 ${s.hours}시간 / 배정 ${allocated(state,s.id)}시간`});
      }
    }
  }
  for (const name of new Set(state.unmapped.filter(a=>!deptId||a.deptId===deptId).map(a=>a.sourceName))) {
    const records=state.unmapped.filter(a=>(!deptId||a.deptId===deptId)&&a.sourceName===name);
    issues.push({type:'alias',deptId:records[0].deptId,sourceName:name,title:`${name}: 원본 과목명 연결 필요`,detail:`${sum(records.map(a=>a.hours))}시간의 교사별 원본 배정을 보관 중입니다. 대응하는 과목을 확인하세요.`});
  }
  return issues;
}
function changeStatus(state, deptId, status) {
  const dept = state.departments.find(d=>d.id===deptId);
  if (!dept || !['draft','submitted','locked'].includes(status)) throw new Error('올바르지 않은 상태입니다.');
  if(status!=='draft' && validate(state,deptId).length) throw new Error('검증 항목을 모두 해결한 후 제출·확정할 수 있습니다.');
  if(status==='locked' && dept.status!=='submitted') throw new Error('교과군에서 먼저 배당표를 제출해 주세요.');
  if(status==='submitted' && dept.status!=='draft') throw new Error('입력 중인 배당표만 제출할 수 있습니다.');
  dept.status=status;
}
function addCourse(state, value) {
  assertDraft(state,value.deptId);
  const name=String(value.name??'').trim();
  if(!name) throw new Error('과목명을 입력하세요.');
  const grade=integer(value.grade,1,3),baseHours=integer(value.baseHours,1,40);
  if(state.courses.some(c=>c.deptId===value.deptId&&c.name===name&&c.grade===grade)) throw new Error('같은 학년의 동일 과목이 있습니다.');
  const c={id:uid('c'),deptId:value.deptId,name,grade,baseHours,credits:null,kind:'subject'};
  state.courses.push(c); return c;
}
function addGroup(state, courseId, label, kind, hoursValue) {
  const c=state.courses.find(c=>c.id===courseId);
  if(!c) throw new Error('과목을 찾을 수 없습니다.');
  assertDraft(state,c.deptId);
  if(groupsOf(state,courseId).some(g=>g.label===label)) throw new Error('이미 추가된 분반입니다.');
  const grade=state.school.grades.find(g=>g.grade===c.grade);
  const labels=kind==='homeroom'?Array.from({length:grade.classCount},(_,i)=>`${c.grade}-${i+1}`):Array.from({length:grade.movingCount},(_,i)=>`${c.grade}${letter(i+1)}`);
  if(!labels.includes(label)) throw new Error('학교 기본 설정에 없는 분반입니다.');
  const hours=integer(hoursValue,1,40),g={id:uid('g'),courseId,label,kind,legacy:[],slots:[],review:false,sourceHours:null,sourceCell:null};
  g.slots=[{id:uid('s'),label,hours}];state.groups.push(g);return g;
}
function removeGroup(state, groupId) {
  const g=state.groups.find(g=>g.id===groupId);
  if(!g) throw new Error('분반을 찾을 수 없습니다.');
  assertDraft(state,state.courses.find(c=>c.id===g.courseId).deptId);
  if(g.legacy.length||g.slots.some(s=>allocated(state,s.id)>0)) throw new Error('배정된 시수를 먼저 해제한 후 분반을 삭제하세요.');
  state.groups=state.groups.filter(g=>g.id!==groupId);
}
function validateSchool(state, value, courseIndex=null) {
  if(!value||typeof value.name!=='string'||!Array.isArray(value.grades)) throw new Error('학교 설정이 올바르지 않습니다.');
  integer(value.year,2000,2100);integer(value.semester,1,2);
  for(const x of value.grades) {integer(x.grade,1,3);integer(x.classCount,0,40);integer(x.movingCount,0,52);}
  if(value.grades.length!==3||new Set(value.grades.map(x=>x.grade)).size!==3) throw new Error('1·2·3학년을 모두 설정하세요.');
  for(const g of state.groups) {
    const c=courseIndex?courseIndex.get(g.courseId):state.courses.find(c=>c.id===g.courseId),cfg=value.grades.find(x=>x.grade===c.grade);
    const labels=g.kind==='homeroom'?Array.from({length:cfg.classCount},(_,i)=>`${c.grade}-${i+1}`):Array.from({length:cfg.movingCount},(_,i)=>`${c.grade}${letter(i+1)}`);
    if(!labels.includes(g.label)) throw new Error(`${g.label} 분반이 과목에 사용 중입니다. 해당 분반을 정리한 후 개수를 줄여 주세요.`);
  }
}
function assertState(state) {
  if(!state||state.schemaVersion!==1||!state.school) throw new Error('지원하지 않는 백업 파일입니다.');
  const keys=['departments','teachers','courses','groups','assignments','unmapped','history'];
  for(const key of keys) if(!Array.isArray(state[key])) throw new Error(`백업의 ${key} 데이터가 올바르지 않습니다.`);
  if(!state.departments.length) throw new Error('교과군이 한 개 이상 필요합니다.');
  if(state.history.some(h=>!h||typeof h.action!=='string'||typeof h.at!=='string'||!Number.isFinite(Date.parse(h.at)))) throw new Error('변경 기록이 올바르지 않습니다.');
  const unique=(rows,label)=>{if(rows.some(x=>typeof x.id!=='string'||!(/^[A-Za-z0-9_-]{1,100}$/).test(x.id))||new Set(rows.map(x=>x.id)).size!==rows.length) throw new Error(`${label} 식별자가 중복되었거나 올바르지 않습니다.`);};
  for(const key of ['departments','teachers','courses','groups','unmapped']) unique(state[key],key);
  unique(state.groups.flatMap(g=>g.slots??[]),'분반');
  // Build lookups once; preserve all existing reference, duplicate, and hours checks.
  const departments=new Map(state.departments.map(d=>[d.id,d])),teachers=new Map(state.teachers.map(t=>[t.id,t])),courses=new Map(state.courses.map(c=>[c.id,c]));
  const sections=new Map(),courseGroups=new Map(),totals=new Map();
  for(const a of state.assignments)if(a)totals.set(a.sectionId,(totals.get(a.sectionId)??0)+a.hours);

  for(const d of state.departments) if(typeof d.name!=='string'||!d.name.trim()||!['draft','submitted','locked'].includes(d.status)) throw new Error('교과군 정보가 올바르지 않습니다.');
  for(const t of state.teachers) if(t.isLead!==undefined&&typeof t.isLead!=='boolean') throw new Error('부장 표시는 체크 값이어야 합니다.');
  for(const t of state.teachers) {if(typeof t.name!=='string'||t.name.length>50||!departments.has(t.deptId)) throw new Error('교사 정보가 올바르지 않습니다.');if(t.targetHours!==null) integer(t.targetHours,0,40);if(t.rows){unique(t.rows,'교사 과목 행');const values=t.rows.map(r=>r.courseId).filter(Boolean);if(new Set(values).size!==values.length||values.some(cid=>courses.get(cid)?.deptId!==t.deptId))throw new Error('교사의 과목 행이 올바르지 않습니다.');}}
  for(const c of state.courses) {
    if(typeof c.name!=='string'||!c.name.trim()||!departments.has(c.deptId)||!['subject','other'].includes(c.kind)) throw new Error('과목 정보가 올바르지 않습니다.');
    integer(c.grade,1,3);integer(c.baseHours,1,40);if(c.credits!==null) integer(c.credits,0,20);
  }
  for(const g of state.groups) {
    const c=courses.get(g.courseId);
    if(!c||!['homeroom','moving'].includes(g.kind)||typeof g.label!=='string'||!g.label||!Array.isArray(g.slots)||!g.slots.length||g.slots.length>6||!Array.isArray(g.legacy)) throw new Error('분반 구조가 올바르지 않습니다.');
    sectionPlan(g.label,g.slots);
    if(g.legacy.length&&g.slots.some(s=>(totals.get(s.id)??0)>0)) throw new Error('합산 배정과 하위 분반 배정이 중복되었습니다.');
    for(const a of g.legacy) {integer(a.hours,1,240);if(teachers.get(a.teacherId)?.deptId!==c.deptId) throw new Error('합산 배정의 교사가 올바르지 않습니다.');}
    if(sum(g.legacy.map(a=>a.hours))>sum(g.slots.map(s=>s.hours))) throw new Error('합산 배정이 필요 시수를 초과합니다.');
    if(!courseGroups.has(g.courseId))courseGroups.set(g.courseId,[]);courseGroups.get(g.courseId).push(g);
    for(const slot of g.slots)sections.set(slot.id,{group:g,slot});
  }
  const seen = new Set();
  for(const a of state.assignments) {
    integer(a.hours,1,40);const section=sections.get(a.sectionId),g=section?.group,c=g&&courses.get(g.courseId);
    if(!c||teachers.get(a.teacherId)?.deptId!==c.deptId) throw new Error('교사 배정의 참조가 올바르지 않습니다.');
    const key=`${a.sectionId}:${a.teacherId}`;if(seen.has(key)) throw new Error('교사 배정이 중복되었습니다.');seen.add(key);
    if((totals.get(a.sectionId)??0)>section.slot.hours) throw new Error('필요 시수를 초과한 배정이 있습니다.');
  }
  for(const u of state.unmapped) {integer(u.hours,1,40);integer(u.grade,1,3);if(typeof u.sourceName!=='string'||typeof u.label!=='string'||(!teachers.has(u.teacherId)||teachers.get(u.teacherId).deptId!==u.deptId)) throw new Error('미연결 원본 배정이 올바르지 않습니다.');}
  for(const c of state.courses) {
    if(new Set((courseGroups.get(c.id)||[]).map(g=>g.label)).size!==(courseGroups.get(c.id)||[]).length) throw new Error('과목 내 상위 분반이 중복되었습니다.');
    if(new Set((courseGroups.get(c.id)||[]).flatMap(g=>g.slots.map(s=>s.label))).size!==(courseGroups.get(c.id)||[]).flatMap(g=>g.slots).length) throw new Error('과목 내 실제 분반명이 중복되었습니다.');
  }
  if(state.customCatalog!==undefined){if(!Array.isArray(state.customCatalog))throw new Error('추가 과목 목록이 올바르지 않습니다.');unique(state.customCatalog,'추가 과목');for(const c of state.customCatalog)if(typeof c.name!=='string'||!c.name.trim()||typeof c.groupId!=='string'||!['공통','일반선택','진로선택','융합선택','학교추가'].includes(c.category))throw new Error('추가 과목 정보가 올바르지 않습니다.');}
  validateSchool(state,state.school,courses);return state;
}
function teacherRows(state,teacherId) {
  const t=state.teachers.find(t=>t.id===teacherId);
  if(!t)throw new Error('교사 행을 찾을 수 없습니다.');
  const as=new Set(state.assignments.filter(a=>a.teacherId===teacherId).map(a=>a.sectionId));
  const assigned=[...new Set(state.groups.filter(g=>g.slots.some(s=>as.has(s.id))||g.legacy.some(a=>a.teacherId===teacherId)).map(g=>g.courseId))];
  const rows=(t.rows??[]).map(r=>({...r}));
  for(const cid of assigned)if(!rows.some(r=>r.courseId===cid))rows.push({id:`row-${teacherId}-${cid}`,courseId:cid});
  return rows.length?rows:[{id:`row-${teacherId}-blank`,courseId:''}];
}
function addTeacher(state,deptId,name='') {
  assertDraft(state,deptId);const text=String(name).trim();
  if(text&&teachersOf(state,deptId).some(t=>t.name===text))throw new Error('같은 이름의 교사가 있습니다. 구분명을 추가하세요.');
  const t={id:uid('t'),deptId,name:text,targetHours:null,sourceTotal:null,rows:[{id:uid('row'),courseId:''}]};state.teachers.push(t);return t;
}
function setTeacherName(state,teacherId,value) {
  const t=state.teachers.find(t=>t.id===teacherId);if(!t)throw new Error('교사 행을 찾을 수 없습니다.');assertDraft(state,t.deptId);
  const name=String(value).trim();if(name.length>50)throw new Error('교사명은 50자 이내로 입력하세요.');
  if(name&&teachersOf(state,t.deptId).some(x=>x.id!==t.id&&x.name===name))throw new Error('같은 이름의 교사가 있습니다. 구분명을 추가하세요.');t.name=name;
}
function addTeacherRow(state,teacherId) {
  const t=state.teachers.find(t=>t.id===teacherId);if(!t)throw new Error('교사 행을 찾을 수 없습니다.');assertDraft(state,t.deptId);t.rows=teacherRows(state,t.id);
  if(t.rows.some(r=>!r.courseId))throw new Error('먼저 빈 과목 행에서 담당 과목을 선택하세요.');
  t.rows.push({id:uid('row'),courseId:''});
}
function setTeacherRow(state,teacherId,rowId,courseId) {
  const t=state.teachers.find(t=>t.id===teacherId);if(!t)throw new Error('교사 행을 찾을 수 없습니다.');assertDraft(state,t.deptId);
  const rows=teacherRows(state,t.id),row=rows.find(r=>r.id===rowId);if(!row)throw new Error('과목 행을 찾을 수 없습니다.');
  if(courseId&&!state.courses.some(c=>c.id===courseId&&c.deptId===t.deptId))throw new Error('이 교과군에 개설된 과목을 선택하세요.');
  if(courseId&&rows.some(r=>r.id!==rowId&&r.courseId===courseId))throw new Error('이미 선택한 담당 과목입니다.');
  if(row.courseId!==courseId&&state.groups.filter(g=>g.courseId===row.courseId).some(g=>g.legacy.some(a=>a.teacherId===t.id)||g.slots.some(s=>state.assignments.some(a=>a.sectionId===s.id&&a.teacherId===t.id))))throw new Error('기존 과목의 배정을 먼저 해제한 후 과목을 바꾸세요.');
  row.courseId=courseId;t.rows=rows;
}
function teacherCourseHours(state,teacherId,courseId) {
  const gs=groupsOf(state,courseId),ids=new Set(gs.flatMap(g=>g.slots.map(s=>s.id)));
  return sum(state.assignments.filter(a=>a.teacherId===teacherId&&ids.has(a.sectionId)).map(a=>a.hours))+sum(gs.flatMap(g=>g.legacy).filter(a=>a.teacherId===teacherId).map(a=>a.hours));
}
function removeTeacherRow(state,teacherId,rowId) {
  const t=state.teachers.find(t=>t.id===teacherId);if(!t)throw new Error('교사 행을 찾을 수 없습니다.');assertDraft(state,t.deptId);
  const rows=teacherRows(state,teacherId),row=rows.find(r=>r.id===rowId);if(!row)throw new Error('과목 행을 찾을 수 없습니다.');
  if(row.courseId){const gs=groupsOf(state,row.courseId),ids=new Set(gs.flatMap(g=>g.slots.map(s=>s.id)));state.assignments=state.assignments.filter(a=>a.teacherId!==teacherId||!ids.has(a.sectionId));for(const g of gs)g.legacy=g.legacy.filter(a=>a.teacherId!==teacherId);}
  t.rows=rows.filter(r=>r.id!==rowId);
}
function setPlannedCell(state,courseId,column,value) {
  const c=state.courses.find(c=>c.id===courseId);if(!c)throw new Error('과목을 찾을 수 없습니다.');assertDraft(state,c.deptId);
  if(column.grade!==c.grade)throw new Error('해당 학년의 열에 입력하세요.');
  const hours=integer(value,0,240),g=groupsOf(state,c.id).find(g=>g.label===column.label);
  if(!hours){if(g)removeGroup(state,g.id);return;}
  if(!g){addGroup(state,c.id,column.label,column.kind,hours);return;}
  if(isSplitGroup(g))throw new Error('분반 설정에서 실제 분반별 시수를 수정하세요.');
  if(g.slots[0].hours===hours)return;
  integer(hours,1,40);if(allocated(state,g.slots[0].id)>hours)throw new Error('교사 배정 합계보다 작습니다. 먼저 담당 시수를 줄여 주세요.');g.slots[0].hours=hours;
}
function updateTeacherGroup(state,groupId,teacherId,values) {
  const next=clone(state),g=next.groups.find(g=>g.id===groupId);if(!g)throw new Error('분반을 찾을 수 없습니다.');
  if(g.legacy.length)throw new Error('원본 합산 배정을 먼저 분리하세요.');
  if(values.length!==g.slots.length)throw new Error('모든 하위 분반의 시수를 입력하세요.');
  const ids=new Set(g.slots.map(s=>s.id));next.assignments=next.assignments.filter(a=>a.teacherId!==teacherId||!ids.has(a.sectionId));
  for(const s of g.slots){const a=values.find(a=>a.sectionId===s.id);if(!a)throw new Error('하위 분반을 확인하세요.');setAssignment(next,s.id,teacherId,a.hours);}
  state.assignments=next.assignments;
}
function removeCourse(state,courseId) {
  const c=state.courses.find(c=>c.id===courseId);if(!c)throw new Error('과목을 찾을 수 없습니다.');assertDraft(state,c.deptId);
  const gs=groupsOf(state,c.id);if(gs.some(g=>g.legacy.length||g.slots.some(s=>allocated(state,s.id))))throw new Error('배정된 시수를 먼저 해제한 후 과목을 삭제하세요.');
  state.groups=state.groups.filter(g=>g.courseId!==c.id);state.courses=state.courses.filter(x=>x.id!==c.id);
  for(const t of state.teachers)if(t.rows)t.rows=t.rows.filter(r=>r.courseId!==c.id);
}
function csv(state, deptId) {
  const rows=[['학년도','학기','교과군','과목','학년','상위분반','실제분반','분반유형','분반필요시수(교사별행 반복)','교사','부장','담당시수','구분']];
  const teacher=id=>{const t=state.teachers.find(t=>t.id===id);return [t.name,t.isLead?'예':''];};
  for(const c of coursesOf(state,deptId)) for(const g of groupsOf(state,c.id)) {
    const prefix=[state.school.year,state.school.semester,state.departments.find(d=>d.id===c.deptId).name,c.name,c.grade];
    for(const s of g.slots) {
      const as=state.assignments.filter(a=>a.sectionId===s.id);
      for(const a of as) rows.push([...prefix,g.label,s.label,g.kind==='moving'?'이동수업':'원반',s.hours,...teacher(a.teacherId),a.hours,'확정 배정']);
      if(!as.length) rows.push([...prefix,g.label,s.label,g.kind==='moving'?'이동수업':'원반',s.hours,'','','',g.legacy.length?'합산 배정 분리 대기':'미배분']);
    }
    for(const a of g.legacy) rows.push([...prefix,g.label,'하위분반 미지정',g.kind==='moving'?'이동수업':'원반','',...teacher(a.teacherId),a.hours,'원본 합산 배정']);
  }
  for(const u of state.unmapped.filter(u=>!deptId||u.deptId===deptId)) rows.push([state.school.year,state.school.semester,state.departments.find(d=>d.id===u.deptId).name,u.sourceName,u.grade,u.label,'과목 미연결',u.kind==='moving'?'이동수업':'원반','',...teacher(u.teacherId),u.hours,'원본 과목명 연결 대기']);
  const cell=x=>{let s=String(x??'');if(/^[=+@\-\t\r]/.test(s)) s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}

export {clone,teacherLabel,normalizeName,nameHash,upgradeState,sum,uid,letter,integer,coursesOf,groupsOf,teachersOf,groupOfSection,allocated,isSplitGroup,teacherHours,metrics,assertDraft,setAssignment,rebuildGroup,groupPlan,setSectionPlan,setGroupPlan,resolvePool,mapSourceName,validate,changeStatus,addCourse,addGroup,removeGroup,validateSchool,assertState,teacherRows,addTeacher,setTeacherName,addTeacherRow,setTeacherRow,teacherCourseHours,removeTeacherRow,setPlannedCell,updateTeacherGroup,removeCourse,csv};
