import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as C from '../../shared/domain.js';
import {exportSolverModel} from '../../shared/timetable-model.js';

// Keep private source rows and all derived models inside the ignored verification directory.
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
for(const name of ['--rows','--html','--out'])if(!args.includes(name)||!arg(name)||arg(name).startsWith('--'))throw new Error(`필수 인자: ${name}`);
const out=resolve(arg('--out')),root=resolve('.cache/timetable-verify'),child=relative(root,out);
if(!child||child.startsWith('..')||isAbsolute(child))throw new Error('--out은 .cache/timetable-verify 하위 폴더여야 합니다.');
await mkdir(out,{recursive:true});
try{
  const rows=JSON.parse(await readFile(arg('--rows'),'utf8'));
  const html=await readFile(arg('--html'),'utf8');
  const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('function exportModelJSON()')&&s.includes('function buildModel(parsed)'));
  if(!script)throw new Error('원본 시간표검증 스크립트를 찾지 못했습니다.');
  let captured;
  class CaptureBlob{constructor(parts){this.parts=parts;}}
  const document={addEventListener(){},querySelectorAll(){return [];},body:{appendChild(){}},createElement(){return {click(){},remove(){}};},
    getElementById(id){if(id.startsWith('w_'))return {value:'1'};if(id.startsWith('o_'))return {checked:id!=='o_coverage'};return null;}};
  const context=vm.createContext({document,window:{},Blob:CaptureBlob,URL:{createObjectURL(blob){captured=JSON.parse(blob.parts.join(''));return 'blob:verification';},revokeObjectURL(){}},
    XLSX:{utils:{sheet_to_json:sheet=>sheet}},inputWorkbook:{Sheets:rows},alert(){throw new Error('원본 모델 생성 실패');}});
  vm.runInContext(script,context,{timeout:10000});
  vm.runInContext('globalThis.parsed = parseWorkbook(inputWorkbook); MODEL=buildModel(parsed); exportModelJSON();',context,{timeout:10000});
  const parsed=JSON.parse(JSON.stringify(context.parsed)),reference=captured;
  assert.ok(reference,'기준 모델 생성 실패');
  const state={schemaVersion:1,uiVersion:3,school:{name:'검증용 로컬 학교',year:2026,semester:2,grades:[1,2,3].map(grade=>({grade,classCount:0,movingCount:0}))},departments:[],teachers:[],courses:[],groups:[],assignments:[],unmapped:[],history:[],departmentRevisions:{}};
  for(const entry of Object.values(parsed.teachers))for(const s of entry.sections){
    const cfg=state.school.grades.find(g=>g.grade===Number(s.grade));
    assert.ok(cfg,'지원하지 않는 학년');
    if(s.type==='ban')cfg.classCount=Math.max(cfg.classCount,Number(s.code));
    else {let n=0;for(const ch of s.code.slice(1))n=n*26+ch.charCodeAt(0)-64;cfg.movingCount=Math.max(cfg.movingCount,n);}
  }
  const byCourse=new Map();
  for(const sheet of parsed.found){
    const d={id:`d${state.departments.length+1}`,name:sheet,status:'draft'};state.departments.push(d);state.departmentRevisions[d.id]=0;
    for(const [name,entry] of Object.entries(parsed.teachers).filter(([,t])=>t.sheet===sheet)){
      const teacher=C.addTeacher(state,d.id,name);teacher.isLead=entry.isBuja;
      for(const s of entry.sections){
        const key=JSON.stringify([d.id,s.grade,s.subject]);
        if(!byCourse.has(key))byCourse.set(key,{course:C.addCourse(state,{deptId:d.id,name:s.subject,grade:Number(s.grade),baseHours:Math.ceil(s.hours)}),groups:new Map()});
        const item=byCourse.get(key),label=s.type==='ban'?`${s.grade}-${s.code}`:s.code;
        if(!item.groups.has(label))item.groups.set(label,{kind:s.type==='ban'?'homeroom':'moving',slots:new Map()});
        const group=item.groups.get(label),div=s.type==='ban'?label:s.raw;
        if(!group.slots.has(div))group.slots.set(div,[]);
        group.slots.get(div).push({teacherId:teacher.id,hours:s.hours});
      }
    }
  }
  const normalizations=[];
  for(const {course,groups} of byCourse.values())for(const [label,plan] of groups){
    if(plan.kind==='moving'&&plan.slots.size>1&&plan.slots.has(label)){
      const normalizedDiv=label+'1';
      assert.ok(!plan.slots.has(normalizedDiv),'상위 분반과 첫 하위 분반이 함께 있어 정규화가 모호합니다.');
      assert.ok([...plan.slots.keys()].every(div=>div===label||new RegExp(`^${label}[2-6]$`).test(div)),'하위 분반 코드가 모호합니다.');
      // The solver only uses (div, subject) for overlap: this bijective rename preserves two distinct divisions.
      plan.slots.set(normalizedDiv,plan.slots.get(label));plan.slots.delete(label);
      normalizations.push({grade:String(course.grade),block:label,subject:course.name,originalDiv:label,normalizedDiv});
    }
    const slots=[...plan.slots].map(([label,rows])=>({label,hours:C.sum(rows.map(r=>r.hours))}));
    C.addGroup(state,course.id,label,plan.kind,slots[0].hours);
    const group=C.setSectionPlan(state,course.id,{grade:course.grade,label,kind:plan.kind},slots);
    for(const slot of group.slots)for(const row of plan.slots.get(slot.label)){
      const current=C.sum(state.assignments.filter(a=>a.sectionId===slot.id&&a.teacherId===row.teacherId).map(a=>a.hours));
      C.setAssignment(state,slot.id,row.teacherId,current+row.hours);
    }
  }
  C.assertState(state);
  for(const d of state.departments){assert.equal(C.validate(state,d.id).length,0,'상태 검증 실패');C.changeStatus(state,d.id,'submitted');C.changeStatus(state,d.id,'locked');}
  C.assertState(state);
  const exported=exportSolverModel(state,{exportedAt:new Date().toISOString()});
  await writeFile(join(out,'export-errors.json'),JSON.stringify({errors:exported.errors,warnings:exported.warnings},null,2));
  assert.equal(exported.errors.length,0,'내보내기 검증 실패 (세부 사항은 비공개 출력 폴더 확인)');
  const model=exported.model;
  const keys=m=>[...m.bans.map(r=>JSON.stringify(['ban',r.grade,r.cls,r.subject,r.teacher,r.hours,r.art])),...m.blocks.map(r=>JSON.stringify(['block',r.grade,r.block,r.div,r.subject,r.teacher,r.hours,r.art??false]))].sort();
  const stats=m=>({teachers:m.teachers.length,totalHours:C.sum([...m.bans,...m.blocks].map(r=>r.hours)),blocks:new Set(m.blocks.map(r=>`${r.grade}:${r.block}`)).size,banRows:m.bans.length,banHours:C.sum(m.bans.map(r=>r.hours)),movingRows:m.blocks.length,movingHours:C.sum(m.blocks.map(r=>r.hours)),rows:m.bans.length+m.blocks.length});
  const rename=(m,reverse=false)=>({...m,blocks:m.blocks.map(row=>{
    const mapping=normalizations.find(n=>n.grade===row.grade&&n.block===row.block&&n.subject===row.subject&&row.div===(reverse?n.normalizedDiv:n.originalDiv));
    return mapping?{...row,div:reverse?mapping.originalDiv:mapping.normalizedDiv}:row;
  })});
  const normalizedReference=rename(reference),rkeys=keys(normalizedReference),ekeys=keys(model),rstats=stats(reference),estats=stats(model);
  const changedReferenceRows=reference.blocks.filter((r,i)=>r.div!==normalizedReference.blocks[i].div).length;
  const comparison={equalRows:JSON.stringify(rkeys)===JSON.stringify(ekeys),equalStatistics:JSON.stringify(rstats)===JSON.stringify(estats),
    normalizationCount:normalizations.length,changedReferenceRows,
    originalDifferencesOnlyMappings:JSON.stringify(keys(reference))===JSON.stringify(keys(rename(model,true))),reference:rstats,exported:estats};
  await Promise.all([writeFile(join(out,'R.json'),JSON.stringify(reference,null,2)),writeFile(join(out,'R-normalized.json'),JSON.stringify(normalizedReference,null,2)),
    writeFile(join(out,'normalizations.json'),JSON.stringify(normalizations,null,2)),writeFile(join(out,'E.json'),JSON.stringify(model,null,2)),writeFile(join(out,'comparison.json'),JSON.stringify(comparison,null,2))]);
  console.log(JSON.stringify(comparison,null,2));
  if(!comparison.equalRows||!comparison.equalStatistics||!comparison.originalDifferencesOnlyMappings)process.exitCode=1;
}catch(error){
  // Errors from domain functions can contain names; never print their messages.
  await writeFile(join(out,'failure.json'),JSON.stringify({message:error.message,stack:error.stack},null,2));
  console.error('모델 대조 실패: 비공개 출력 폴더의 failure.json을 확인하세요.');process.exitCode=1;
}
