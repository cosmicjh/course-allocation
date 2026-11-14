// Regenerate only with synthetic data:
// timetable-solver\runtime\python.exe timetable-solver/tools/export_golden.py
// Python's pybind builder and the WASM JS builder emit different default fields and
// term order. Compare normalized protobuf JSON, retaining variable indexes, names,
// domains, coefficients, enforcement, objectives and hints (not just counts).
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as api from 'or-tools-wasm/cp-sat';
import {validateModel,buildStage,solveTimetable,scoreBounds} from '../shared/timetable-cpsat.js';
import {checkTimetable} from '../shared/timetable-checker.js';
api.setCloudNoticeEnabled(false);
after(async()=>api.terminateLoadedRuntimeThreads());
const root=new URL('./fixtures/timetable-cpsat/',import.meta.url);
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const sort=xs=>xs.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
export function normalizeProto(value){
  const walk=(v,k='')=>{
    if(Array.isArray(v))return v.map(x=>walk(x));
    if(v&&typeof v==='object'){
      const out={};for(const name of Object.keys(v).sort()){
        const item=walk(v[name],name);
        if(item===undefined||item===0||item===false||item===''||(Array.isArray(item)&&!item.length))continue;
        out[name]=item;
      }
      if(v.vars&&v.coeffs){const terms=v.vars.map((x,i)=>[Number(x),Number(v.coeffs[i])]).filter(([,c])=>c!==0).sort((a,b)=>a[0]-b[0]);if(terms.length){out.vars=terms.map(x=>x[0]);out.coeffs=terms.map(x=>x[1]);}else{delete out.vars;delete out.coeffs;}}
      if(k==='solutionHint'){const terms=v.vars.map((x,i)=>[Number(x),Number(v.values[i])]).sort((a,b)=>a[0]-b[0]);out.vars=terms.map(x=>x[0]);out.values=terms.map(x=>x[1]);}
      if(out.exprs)sort(out.exprs);
      if(k==='objective'&&!out.scalingFactor)out.scalingFactor=1;
      if(out.literals)out.literals.sort((a,b)=>a-b);
      if(out.enforcementLiteral)out.enforcementLiteral.sort((a,b)=>a-b);
      if(out.constraints)sort(out.constraints);
      return out;
    }
    if(typeof v==='bigint'||(typeof v==='string'&&/^-?\d+$/.test(v))){const n=BigInt(v);return n>=BigInt(Number.MIN_SAFE_INTEGER)&&n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):String(n);}return v;
  };return walk(value);
}
for(const name of (await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name)){
  const dir=new URL(`${name}/`,root),input=await json(new URL('input.json',dir)),v=validateModel(input.model,input.options),stages=await json(new URL('stages.json',dir));
  let prior;try{prior=await json(new URL('warm-start.json',dir));}catch(e){if(e.code!=='ENOENT')throw e;}
  const strict=new Map(Object.entries(await json(new URL('strict-hint.json',dir))));
  test(`Python proto parity: ${name}`,async t=>{
    assert.deepEqual(v.errors,[]);
    for(const stage of ['0','1','2','2.5']){
      const b=buildStage(v.model,v.options,api,{stage,...stages,hint:stage==='2'||stage==='2.5'?strict:new Map(),warmStart:stage==='1'?prior:undefined});
      const expected=await json(new URL(`${stage}.json`,dir));
      const bytes=await api.CpSat.createModel(b.cm.modelProto),golden=await readFile(new URL(`${stage}.bin`,dir));
      if(!Buffer.from(bytes).equals(golden))t.diagnostic(`stage ${stage}: serialization differs; comparing normalized protobuf fields`);
      assert.deepEqual(normalizeProto(b.cm.modelProto),normalizeProto(expected),`${name} stage ${stage}`);
      if(stage==='1'&&prior)assert.deepEqual(b.warmStart,await json(new URL('warm-stats.json',dir)));
    }
  });
  test(`Python checker parity: ${name}`,async()=>{
    const cases=await json(new URL('checker.json',dir));assert.equal(cases[0].expected.ok,true);
    for(const c of cases)assert.deepEqual(checkTimetable(v.model,c.result,v.options),c.expected);
  });
}

const ruleCases=await json(new URL('checker-rules.json',root));
for(const c of ruleCases)test(`Python isolated checker rejection: ${c.name}`,()=>{
  assert.equal(c.validExpected.ok,true);
  assert.deepEqual(c.invalidExpected.errors,[c.rule]);
  assert.equal(c.invalidExpected.ok,false);
  assert.deepEqual(checkTimetable(c.model,c.valid,c.options),c.validExpected);
  assert.deepEqual(checkTimetable(c.model,c.invalid,c.options),c.invalidExpected);
});
test('isolated checker fixtures cover every required rule',()=>{
  assert.deepEqual(ruleCases.map(c=>c.name).sort(),[
    'teacher-real-overlap','class-hole-and-duplicate','row-hours','block-different-days','block-slot-count',
    'same-grade-block-overlap','section-subject-overlap','block-forbidden-cell','lead-friday-first',
    'grade-three-career','first-period-day-count','last-period-day-count','daily-hours-lower','daily-hours-upper',
    'four-consecutive','lunch-two-fourth-periods','art-two-plus-one','dependent-subject','instructor-days',
    'two-per-day-separation','subject-once-per-day','score-recalculation',
  ].sort());
});
test('vendor checker fails on missing or differing copies; allow-missing is explicit',async()=>{
  const cache=new URL('../.cache/timetable-verify/',import.meta.url);await mkdir(cache,{recursive:true});
  const temp=await mkdtemp(fileURLToPath(new URL('vendor-check-test-',cache))),root=pathToFileURL(temp+'/');
  try{
    await mkdir(new URL('scripts/timetable/',root),{recursive:true});await mkdir(new URL('shared/',root));
    const script=new URL('scripts/timetable/vendor-check.mjs',root);await writeFile(script,await readFile(new URL('../scripts/timetable/vendor-check.mjs',import.meta.url)));
    const names=['timetable-model.js','timetable-cpsat.js','timetable-checker.js'];
    for(const name of names)await writeFile(new URL(`shared/${name}`,root),'// synthetic\n');
    const run=(...args)=>{const r=spawnSync(process.execPath,[fileURLToPath(script),...args],{encoding:'utf8'});assert.ifError(r.error);return r;};
    assert.equal(run().status,1);assert.equal(run('--allow-missing').status,0);
    await mkdir(new URL('timetable-cloudflare/vendor/course-allocation/shared/',root),{recursive:true});
    for(const name of names)await writeFile(new URL(`timetable-cloudflare/vendor/course-allocation/shared/${name}`,root),`// Source: course-allocation/shared/${name}\n// synthetic\n`);
    assert.equal(run().status,0);
    await writeFile(new URL('timetable-cloudflare/vendor/course-allocation/shared/timetable-checker.js',root),'// different synthetic content\n');
    assert.equal(run().status,1);assert.equal(run('--allow-missing').status,1);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('WASM solve, warm start, skipped stage zero, progress and cancellation',async()=>{
  const input=await json(new URL('small/input.json',root)),events=[];
  const result=await solveTimetable(input.model,{},api,{limits:[10,0,0],workers:1,onProgress:e=>events.push(e)});
  assert.equal(result.status,'SUCCESS');assert.equal(result.checker.ok,true);assert.equal(result.stages[0].reason,'zero_limit');assert.equal(result.stages[1].status,'OPTIMAL');
  assert.ok(events.some(e=>e.type==='stage-start'));assert.ok(events.some(e=>e.type==='stage-end'));assert.ok(events.some(e=>e.type==='solution'));
  const again=await solveTimetable(input.model,{startLimit:10},api,{limits:[10,1,1],workers:1,warmStart:result});
  assert.equal(again.status,'SUCCESS');assert.equal(again.warmStart.matchRate,1);assert.equal(again.stages[0].reason,'previous_result');
  const abort=new AbortController();abort.abort();assert.equal((await solveTimetable(input.model,{},api,{signal:abort.signal})).status,'CANCELLED');
  const live=new AbortController();const cancelled=await solveTimetable(input.model,{},api,{signal:live.signal,workers:1,limits:[10,0,0],onProgress:e=>{if(e.type==='stage-start')live.abort();}});assert.equal(cancelled.status,'CANCELLED');
});
test('regular-teacher WASM scores and relaxed stage',async()=>{
  const input=await json(new URL('normal-pair/input.json',root)),prior=(await json(new URL('normal-pair/checker.json',root)))[0].result;
  const r=await solveTimetable(input.model,input.options,api,{limits:[10,5,1],warmStart:prior,workers:1});assert.equal(r.status,'SUCCESS');assert.equal(r.checker.ok,true);assert.ok(Object.keys(r.scores).length);
  const {model}=await json(new URL('small/input.json',root));const relaxed=await solveTimetable(model,{startLimit:5},api,{limits:[5,0,0],workers:1});assert.equal(relaxed.stages[0].status,'OPTIMAL');assert.equal(relaxed.stages[0].adopted,false);assert.equal(relaxed.warmStart.source,'relaxed_daily_min');assert.equal(relaxed.checker.ok,true);
});
test('status distinctions and strict solution preservation',async()=>{
  const {model}=await json(new URL('small/input.json',root));
  const invalid=await solveTimetable({...model,_version:2},{},api);assert.equal(invalid.status,'VALIDATION_ERROR');
  const impossible=await solveTimetable(model,{gangsaDayCount:{가상강사:1}},api,{limits:[5,0,0],workers:1});assert.equal(impossible.status,'INFEASIBLE');
  const unknown=await solveTimetable(model,{},api,{limits:[0,0,0],workers:1});assert.equal(unknown.status,'UNKNOWN');
  for(const status of [0,1,3]){
    let calls=0;const fake={...api,CpSat:{...api.CpSat,solveProto:async(bytes,options)=>++calls===1?api.CpSat.solveProto(bytes,options):{response:{status,wallTime:0}}}};
    const result=await solveTimetable(model,{},fake,{limits:[5,1,1],workers:1});assert.equal(result.status,'SUCCESS');assert.equal(result.adoptedStage,'1');assert.equal(result.stages[2].status,['UNKNOWN','MODEL_INVALID',null,'INFEASIBLE'][status]);
  }
  const fake={...api,CpSat:{...api.CpSat,solveProto:async()=>({response:{status:1}})}};assert.equal((await solveTimetable(model,{},fake,{limits:[5,0,0]})).status,'MODEL_INVALID');
  assert.deepEqual(scoreBounds({over4:-2,lunch:3,run3:2,firstlast:4},12),[-164,164]);
});
test('input boundary rejects malformed IDs, roles, options and zero-class placements',async()=>{
  const {model}=await json(new URL('small/input.json',root));
  for(const mutate of [m=>{m.blocks[0].rowId=null;},m=>{m.options=null;},m=>{m.flags=null;},m=>{m.classes={'2':0};},m=>{m.gangsa=['unknown'];}]){
    const m=structuredClone(model);mutate(m);assert.ok(validateModel(m).errors.length);
  }
  assert.ok(validateModel(model,{weights:{run3:1.5}}).errors.length);
  assert.ok(validateModel(model,{},[NaN,0,0]).errors.length);
});
