import test from 'node:test';
import assert from 'node:assert/strict';
import {exportSolverModel} from '../shared/timetable-model.js';
import {assertState} from '../shared/domain.js';
import {solverState} from './fixtures/timetable.js';

test('v1 model preserves assignment rows, names, div, roles and provenance without mutating input',()=>{
  const state=solverState(),before=JSON.stringify(state),exportedAt='2026-11-13T00:00:00Z';
  const {model,errors,warnings}=exportSolverModel(state,{exportedAt});
  assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.equal(JSON.stringify(state),before);
  for(const key of ['_type','_version','week','rtMap','lunch','teachers','buja','gangsa','teacherTotal','flags','blocks','bans','options','source','classes'])assert.ok(Object.hasOwn(model,key),key);
  assert.equal(model._type,'시간표_솔버모델');assert.equal(model._version,1);
  assert.deepEqual(model.bans.map(r=>[r.grade,r.cls,r.subject,r.hours,r.art]),[['3','1','통합사회',14,true],['3','1','통합사회',14,true]]);
  assert.deepEqual(model.blocks.map(r=>[r.block,r.div,r.blockLen,r.subject,r.hours]),[['3A','3A1',3,'통합사회2',3],['3A','3A2',3,'통합사회2',2]]);
  assert.deepEqual(model.buja,['가상교사']);assert.deepEqual(model.gangsa,['가상강사']);assert.deepEqual(model.teacherTotal,{'가상교사':17,'가상강사':16});
  const rows=[...model.bans,...model.blocks];assert.equal(new Set(rows.map(r=>r.rowId)).size,4);
  for(const r of rows){assert.ok(state.teachers.some(t=>t.id===r.teacherId));assert.ok(state.courses.some(c=>c.id===r.courseId));assert.ok(state.groups.some(g=>g.slots.some(s=>s.id===r.sectionId)));}
  assert.deepEqual(model.source,{term:'2026-2',departmentRevisions:{art:7},exportedAt});assert.deepEqual(model.classes,{1:0,2:0,3:1});
  assert.deepEqual(model.options.weights,{over4:1,run3:1,lunch:1,firstlast:1});assert.deepEqual(model.options.dependents,[]);
  assert.deepEqual(model.options.pairAllowList,[]);assert.deepEqual(model.options.gangsaDayCount,{});
  assert.deepEqual(model.rtMap[3],[1,2,3,5,6,7,8]);assert.equal(Object.values(model.week.periodsByDay).flat().length,31);
});

for(const [name,mutate,pattern] of [
  ['unconfirmed department',s=>s.departments[0].status='draft',/확정/],
  ['legacy',s=>s.groups[0].legacy=[{teacherId:s.teachers[0].id,hours:1}],/합산 배정/],
  ['unmapped',s=>s.unmapped.push({deptId:'art',sourceName:'가상원본',label:'3A',teacherId:s.teachers[0].id,hours:1}),/미연결/],
  ['duplicate teacher names',s=>s.teachers[1].name=s.teachers[0].name,/이름이 같은/],
  ['whitespace duplicate names',s=>s.teachers[1].name='가상 교사',/이름이 같은/],
  ['blank name',s=>s.teachers[0].name='',/교사명/],
  ['fractional assignment',s=>s.assignments[0].hours=1.5,/양의 정수/],
  ['zero assignment',s=>s.assignments[0].hours=0,/양의 정수/],
  ['negative assignment',s=>s.assignments[0].hours=-1,/양의 정수/],
  ['fractional slot',s=>s.groups[0].slots[0].hours=28.5,/양의 정수/],
  ['zero slot',s=>s.groups[0].slots[0].hours=0,/양의 정수/],
  ['teacher over block length',s=>s.assignments[3].teacherId=s.teachers[0].id,/블록 내 교사 배당 합/],
  ['class weekly total',s=>s.assignments[0].hours=13,/주간 합/],
  ['class without lessons',s=>s.school.grades[0].classCount=1,/1-1: 학급 주간 합/],
  ['invalid grade',s=>s.courses[0].grade=4,/학년은 1~3/],
  ['invalid homeroom',s=>s.groups[0].label='3-0',/학년-반/],
])test(`blocks export: ${name}`,()=>{const state=solverState();mutate(state);const result=exportSolverModel(state);assert.equal(result.model,null);assert.ok(result.errors.some(e=>pattern.test(e)),result.errors.join('\n'));assert.ok(result.errors.every(e=>e.includes(':')));});

test('dependent defaults use exact original strings and only subjects present',()=>{
  const state=solverState();state.courses[0].name='스포츠과학';state.courses[1].name='음악감상과비평(2학년)';
  assert.deepEqual(exportSolverModel(state).model.options.dependents,[{subject:'스포츠과학',follows:['음악감상과비평(2학년)']}]);
  state.courses[1].name='음악 감상과 비평';assert.deepEqual(exportSolverModel(state).model.options.dependents,[]);
});

test('unassigned teachers are omitted from every solver teacher field with ID-based warnings',()=>{
  const state=solverState(),baseline=exportSolverModel(state).model;
  const unassigned=[
    {id:'idle',deptId:'art',name:'가상미배당교사',targetHours:null},
    {id:'idle-lead',deptId:'art',name:'가상미배당부장',targetHours:null,isLead:true},
    {id:'idle-gangsa',deptId:'art',name:'가상미배당강사',targetHours:null},
  ];
  state.teachers=[unassigned[0],state.teachers[1],unassigned[1],state.teachers[0],unassigned[2]];
  assertState(state);
  const before=JSON.stringify(state),{model,errors,warnings}=exportSolverModel(state);
  assert.deepEqual(errors,[]);assert.equal(JSON.stringify(state),before);
  assert.deepEqual(model.teachers,['가상강사','가상교사']);
  assert.deepEqual(model.buja,baseline.buja);assert.deepEqual(model.gangsa,baseline.gangsa);
  assert.deepEqual(model.teacherTotal,baseline.teacherTotal);
  assert.deepEqual(model.bans,baseline.bans);assert.deepEqual(model.blocks,baseline.blocks);
  assert.deepEqual(warnings,unassigned.map(t=>`미술 / 교사 ${t.id}: 배당 시수가 없어 모델에서 제외했습니다.`));
  for(const t of unassigned)assert.ok(!JSON.stringify(model).includes(t.name));
});

test('duplicate teacher names still block export when one teacher is unassigned',()=>{
  const state=solverState();state.teachers.push({id:'idle-duplicate',deptId:'art',name:state.teachers[0].name,targetHours:null});
  const {model,errors}=exportSolverModel(state);
  assert.equal(model,null);assert.ok(errors.some(e=>e.includes('idle-duplicate')&&e.includes('이름이 같은')));
});
