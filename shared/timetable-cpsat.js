// CP-SAT is injected: the browser and Node load different runtime entry points.
import {checkTimetable} from './timetable-checker.js';

export const PBD = [[2,3,4,5,6,7],[1,2,3,4,5,6,7],[1,2,3,4],[1,2,3,4,5,6,7],[1,2,3,4,5,6,7]];
export const RT = {'1':[0,1,2,3,4,6,7,8],'2':[0,1,2,3,4,6,7,8],'3':[0,1,2,3,5,6,7,8]};
const CELLS=PBD.flatMap((ps,d)=>ps.map(p=>[d,p])), MAX=[4,5,3,5,5];
const REAL=[[2,3,4,5,6,7,8],[1,2,3,4,5,6,7,8],[1,2,3,4,5],[1,2,3,4,5,6,7,8],[1,2,3,4,5,6,7,8]];
const key=(...parts)=>JSON.stringify(parts);
const group=(map,k,value)=>{if(!map.has(k))map.set(k,[]);map.get(k).push(value);};
const entries=map=>[...map].map(([k,v])=>[JSON.parse(k),v]);
const values=map=>[...map.values()];
const get=(map,...k)=>map.get(key(...k));
const set=(map,k,v)=>map.set(key(...k),v);
function chains(n){
  const adj=new Set(['1,2','2,3','3,4','3,5','4,6','5,6','6,7','7,8']), result=[];
  const extend=p=>{if(p.length===n){result.push(p);return;}for(let i=1;i<=8;i++)if(i>p.at(-1)&&adj.has(`${p.at(-1)},${i}`))extend([...p,i]);};
  for(let i=1;i<=8;i++)extend([i]);return result;
}
export function scoreBounds(weights={},hours=0){
  const a=Math.abs(weights.over4??1)*(hours+22)+Math.abs(weights.firstlast??1)*4+16*(Math.abs(weights.lunch??1)+Math.abs(weights.run3??1));
  return [-a,a];
}

export function buildCpModel(m, options={}, api, {dailyMin=true}={}){
  const {CpModel,LinearExpr:E}=api, cm=new CpModel(), sum=xs=>E.sum(xs);
  const eq=(a,b)=>cm.add(E.from(a).eq(b)), le=(a,b)=>cm.add(E.from(a).le(b));
  const blocks=new Map(),slot=new Map(),secs=new Map(),y=new Map(),place=new Map(),subj=new Map(),banUnit=new Map();
  for(const [i,b] of m.blocks.entries()){
    if(!Object.hasOwn(b,'div'))throw new Error('분반 세부코드(div)가 없습니다.');
    set(blocks,[b.grade,b.block],{len:b.blockLen});group(secs,key(b.grade,b.block),{i,...b});
  }
  const cells=name=>new Map(CELLS.map(([d,p])=>[key(d,p),cm.newBoolVar(`${name}_${d}_${p}`)]));
  for(const [[g,bc],info] of entries(blocks)){
    const sv=[];
    for(let si=0;si<info.len;si++){const v=cells(`s${g}${bc}${si}`);eq(sum(values(v)),1);set(slot,[g,bc,si],v);sv.push(v);}
    for(let d=0;d<5;d++){const vs=sv.flatMap(v=>PBD[d].map(p=>get(v,d,p)));if(vs.length>1)le(sum(vs),1);}
    for(const [d,p] of options.blockTimeBan?.[bc]??[])for(let si=0;si<info.len;si++){const v=get(get(slot,g,bc,si),d,p);if(v)eq(v,0);}
  }
  const bycell=new Map();
  for(const [[g,bc],info] of entries(blocks))for(let si=0;si<info.len;si++)for(const [[d,p],v] of entries(get(slot,g,bc,si)))group(bycell,key(g,d,p),v);
  for(const vs of bycell.values())if(vs.length>1)le(sum(vs),1);
  for(const [[g,bc],info] of entries(blocks)){
    const rows=get(secs,g,bc),L=info.len;
    for(const row of rows){const ys=Array.from({length:L},(_,si)=>cm.newBoolVar(`y${row.i}_${si}`));ys.forEach((v,si)=>set(y,[row.i,si],v));eq(sum(ys),row.hours);}
    const byds=new Map();for(const row of rows)group(byds,key(row.div,row.subject),row.i);
    for(const idxs of byds.values())for(let si=0;si<L;si++){const xs=idxs.map(i=>get(y,i,si));if(xs.length>1)le(sum(xs),1);}
    for(const row of rows)for(let si=0;si<L;si++)for(const [[d,p],sv] of entries(get(slot,g,bc,si))){
      const pl=cm.newBoolVar(`pb${row.i}_${si}_${d}_${p}`);cm.addMultiplicationEquality(pl,[get(y,row.i,si),sv]);
      group(place,key(row.teacher,d,RT[g][p]),pl);group(subj,key(g,row.subject,d,p),pl);
    }
  }
  for(const dep of options.dependents??[]){
    if(!dep.subject||!dep.follows?.length)continue;
    const grades=new Set(m.blocks.filter(r=>[dep.subject,...dep.follows].includes(r.subject)).map(r=>r.grade));
    for(const g of grades)for(const [d,p] of CELLS){
      const main=get(subj,g,dep.subject,d,p),follow=dep.follows.flatMap(s=>get(subj,g,s,d,p)??[]);
      if(!main?.length||!follow.length)continue;
      const a=cm.newBoolVar(`depM_${g}_${dep.subject}_${d}_${p}`);cm.addMaxEquality(a,main);
      const b=cm.newBoolVar(`depF_${g}_${dep.subject}_${d}_${p}`);cm.addMaxEquality(b,follow);le(sum([a,b]),1);
    }
  }
  for(const [i,l] of m.bans.entries()){
    const units=[];for(let h=0;h<l.hours;h++){const v=cells(`u${i}_${h}`),placed=cm.newBoolVar(`pp${i}_${h}`);eq(sum(values(v)),placed);units.push({cells:v,placed});}
    banUnit.set(i,{units,g:l.grade,cls:l.cls,sub:l.subject,t:l.teacher,art:!!l.art});
  }
  const raw=()=>{
    const r=new Map([...place].map(([k,vs])=>[k,[...vs]]));
    for(const bu of banUnit.values())for(const u of bu.units)for(const [[d,p],v] of entries(u.cells))group(r,key(bu.t,d,RT[bu.g][p]),v);return r;
  };
  for(const vs of raw().values())if(vs.length>1)le(sum(vs),1);
  const clsUnits=new Map();for(const bu of banUnit.values())for(const u of bu.units)group(clsUnits,key(bu.g,bu.cls),u);
  for(const [[g],units] of entries(clsUnits))for(const [d,p] of CELLS){const terms=[...units.map(u=>get(u.cells,d,p)),...(get(bycell,g,d,p)??[])];if(terms.length)eq(sum(terms),1);}
  for(const bu of banUnit.values())if(m.buja.includes(bu.t)&&!bu.sub.includes('진로'))for(const u of bu.units)eq(get(u.cells,4,1),0);
  for(const bu of banUnit.values())if(bu.g==='3'&&bu.sub.includes('진로'))for(const u of bu.units)eq(get(u.cells,4,1),1);
  const normal=new Map(),art=new Map();
  for(const [i,bu] of banUnit)group(bu.art?art:normal,key(bu.g,bu.cls,bu.sub,bu.t),i);
  for(const [[g,cls,sub,t],idxs] of entries(normal)){
    if(m.gangsa.includes(t))continue;
    for(let d=0;d<5;d++){
      const dv=idxs.flatMap(i=>banUnit.get(i).units.flatMap(u=>PBD[d].map(p=>[p,get(u.cells,d,p)])));
      const allow=options.pairAllowList?.includes(sub);le(sum(dv.map(x=>x[1])),allow?2:1);
      if(allow)for(let a=0;a<dv.length;a++)for(let b=a+1;b<dv.length;b++)if(Math.abs(dv[a][0]-dv[b][0])<3)le(sum([dv[a][1],dv[b][1]]),1);
    }
  }
  const and=(v,xs)=>{cm.addBoolAnd(xs).onlyEnforceIf(v);cm.addBoolOr(xs.map(x=>x.not())).onlyEnforceIf(v.not());};
  for(const [[g,cls],idxs] of entries(art)){
    const units=idxs.flatMap(i=>banUnit.get(i).units),day=d=>units.flatMap(u=>PBD[d].map(p=>get(u.cells,d,p))),pairs=[];
    for(let d=0;d<5;d++)le(sum(day(d)),2);
    for(let d=0;d<5;d++)for(let k=0;k<PBD[d].length-1;k++){
      const p=PBD[d][k],q=PBD[d][k+1];if(q-p!==1||p===4)continue;
      const a=cm.newBoolVar(`art_${g}${cls}_${d}_${p}a`);cm.addMaxEquality(a,units.map(u=>get(u.cells,d,p)));
      const b=cm.newBoolVar(`art_${g}${cls}_${d}_${p}b`);cm.addMaxEquality(b,units.map(u=>get(u.cells,d,q)));
      const pr=cm.newBoolVar(`artpair_${g}${cls}_${d}_${p}`);and(pr,[a,b]);pairs.push([d,pr]);
    }
    eq(sum(pairs.map(x=>x[1])),1);for(const [d,pr] of pairs)eq(sum(day(d)),2).onlyEnforceIf(pr);
  }
  for(const [t,N] of Object.entries(options.gangsaDayCount??{})){
    if(!m.gangsa.includes(t))continue;const dus=[];
    for(let d=0;d<5;d++){
      const du=cm.newBoolVar(`gd${t}${d}`),tv=[];
      for(const bu of banUnit.values())if(bu.t===t)for(const u of bu.units)for(const p of PBD[d])tv.push(get(u.cells,d,p));
      for(const [[name,day],vs] of entries(place))if(name===t&&day===d)tv.push(...vs);
      if(tv.length){for(const v of tv)cm.add(du.ge(v));le(du,sum(tv));}dus.push(du);
    }le(sum(dus),N);
  }
  const occ=new Map();for(const [[t,d,rt],vs] of entries(raw())){const b=cm.newBoolVar(`oc_${t}_${d}_${rt}`);cm.addMaxEquality(b,vs);set(occ,[t,d,rt],b);}
  for(const t of m.teachers){if(m.gangsa.includes(t))continue;for(let d=0;d<5;d++){const a=get(occ,t,d,4),b=get(occ,t,d,5);if(a&&b)le(sum([a,b]),1);}}
  for(const t of m.teachers){
    if(m.gangsa.includes(t))continue;
    for(const [tag,ds,rt] of [['f1',[1,2,3,4],1],['f7',[0,1,3,4],8]]){
      const free=[];for(const d of ds){const has=get(occ,t,d,rt),f=cm.newBoolVar(`${tag}_${t}_${d}`);eq(has?sum([f,has]):f,1);free.push(f);}
      cm.add(E.from(sum(free)).ge(1));le(sum(free),2);
    }
    for(let d=0;d<5;d++){const daily=REAL[d].map(rt=>get(occ,t,d,rt)).filter(Boolean);if(daily.length)le(sum(daily),MAX[d]);}
    if(dailyMin)for(let d=0;d<5;d++){const daily=REAL[d].map(rt=>get(occ,t,d,rt)).filter(Boolean);if(daily.length)cm.add(E.from(sum(daily)).ge(2));}
    for(let d=0;d<5;d++)for(const ch of chains(4)){const vs=ch.map(rt=>get(occ,t,d,rt)).filter(Boolean);if(vs.length===4)le(sum(vs),3);}
  }
  const units=[...banUnit.values()].flatMap(b=>b.units);
  return {cm,slot,blocks,secs,y,banUnit,place,total:units.length,placed:sum(units.map(u=>u.placed)),api};
}

export function teacherOccupancy(b){
  const raw=new Map([...b.place].map(([k,vs])=>[k,[...vs]])),occ=new Map();
  for(const bu of b.banUnit.values())for(const u of bu.units)for(const [[d,p],v] of entries(u.cells))group(raw,key(bu.t,d,RT[bu.g][p]),v);
  for(const [[t,d,rt],vs] of entries(raw)){const v=b.cm.newBoolVar(`occ_${t}_${d}_${rt}`);b.cm.addMaxEquality(v,vs);set(occ,[t,d,rt],v);}return occ;
}
export function stepCost(cm,terms,tag,weight,api){
  if(!terms.length)return 0;const E=api.LinearExpr,n=cm.newIntVar(0,terms.length,`n_${tag}`);cm.add(n.eq(E.sum(terms)));const ges=[];
  for(const [k,add] of [[1,1],[2,1],[3,2],[4,4],[5,8]]){const v=cm.newBoolVar(`ge${k}_${tag}`);cm.add(n.ge(k)).onlyEnforceIf(v);cm.add(n.le(k-1)).onlyEnforceIf(v.not());ges.push(v.times(add));}
  return E.from(E.sum(ges)).times(weight);
}
export function discomfortTerms(b,occ,teachers,weights={},hours={}){
  const {cm,api}=b,E=api.LinearExpr,w=k=>weights[k]??1,pen=new Map();
  const and=(v,xs)=>{cm.addBoolAnd(xs).onlyEnforceIf(v);cm.addBoolOr(xs.map(x=>x.not())).onlyEnforceIf(v.not());};
  for(const t of teachers){
    const terms=[];
    for(let d=0;d<5;d++){const cnt=REAL[d].map(rt=>get(occ,t,d,rt)).filter(Boolean),n=cm.newIntVar(0,8,`n_${t}_${d}`);cm.add(n.eq(E.sum(cnt)));terms.push(n.minus(MAX[d]).times(w('over4')));}
    for(const [ds,rt] of [[[1,2,3,4],1],[[0,1,3,4],8]]){const xs=ds.map(d=>get(occ,t,d,rt)).filter(Boolean);if(xs.length)terms.push(E.from(E.sum(xs)).minus(2).times(w('firstlast')));}
    const lunches=[];
    for(let d=0;d<5;d++){
      const daily=[];for(const [tag,a,c] of [['A',4,6],['B',3,5]]){const xs=[get(occ,t,d,a),get(occ,t,d,c)];if(xs.every(Boolean)){const v=cm.newBoolVar(`lun${tag}_${t}_${d}`);and(v,xs);daily.push(v);}}
      if(daily.length){const v=cm.newBoolVar(`lunday_${t}_${d}`);cm.addMaxEquality(v,daily);lunches.push(v);}
    }terms.push(stepCost(cm,lunches,`lun_${t}`,w('lunch'),api));
    const runs=[];for(let d=0;d<5;d++)for(const ch of chains(3)){const xs=ch.map(rt=>get(occ,t,d,rt));if(xs.every(Boolean)){const v=cm.newBoolVar(`r3_${t}_${d}_${ch[0]}_${ch[2]}`);and(v,xs);runs.push(v);}}
    terms.push(stepCost(cm,runs,`run_${t}`,w('run3'),api));
    const [lo,hi]=scoreBounds(weights,hours[t]??0),v=cm.newIntVar(lo,hi,`pen_${t}`);cm.add(v.eq(E.sum(terms)));pen.set(t,v);
  }return pen;
}

export function decisionVariables(b,{includeBans=true}={}){
  const vars=[...[...b.slot.values()].flatMap(values),...b.y.values()];if(includeBans)for(const bu of b.banUnit.values())for(const u of bu.units)vars.push(...u.cells.values(),u.placed);
  return new Map(vars.map(v=>[v.name,v]));
}
export function captureHint(b,solution,options){return new Map([...decisionVariables(b,options)].map(([n,v])=>[n,Number(solution[v.index])]));}
export function applyHint(b,hint){for(const [n,v] of decisionVariables(b))if(hint.has(n))b.cm.addHint(v,hint.get(n));}
export function validateWarmStart(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!['SEC_PLACE','BAN_PLACE'].some(k=>Object.hasOwn(value,k)))throw new Error('시작점은 배치 행이 포함된 result.json이어야 합니다.');
  if(['SEC_PLACE','BAN_PLACE','blockSlots'].some(k=>!Array.isArray(value[k]??[])))throw new Error('시작점 배치와 블록 슬롯은 배열이어야 합니다.');return value;
}
export function hintFromResult(m,previous,b){
  validateWarmStart(previous);const hint=new Map(),positions=new Map(),source=new Set(),matched=new Set();
  for(const [kind,k] of [['blocks','SEC_PLACE'],['bans','BAN_PLACE']]){
    const current=new Map(m[kind].map((r,i)=>[r.rowId,i]));
    for(const r of previous[k]??[]){if(!r||typeof r.rowId!=='string')continue;source.add(r.rowId);if(!current.has(r.rowId))continue;matched.add(r.rowId);
      if(Number.isInteger(r.d)&&Number.isInteger(r.p)&&PBD[r.d]?.includes(r.p)){const k=key(kind,current.get(r.rowId));if(!positions.has(k))positions.set(k,new Set());positions.get(k).add(key(r.d,r.p));}
    }
  }
  const matching=new Set(m.blocks.filter((r,i)=>positions.has(key('blocks',i))).map(r=>key(r.grade,r.block))),bcells=new Map();
  const put=(g,bc,si,cell)=>{const k=key(g,bc);if(!bcells.has(k))bcells.set(k,new Map());const cells=bcells.get(k);if(!cells.has(si)&&![...cells.values()].includes(cell))cells.set(si,cell);};
  for(const r of previous.blockSlots??[])if(r&&matching.has(key(r.g,r.block))&&Number.isInteger(r.slot)&&get(b.slot,r.g,r.block,r.slot)&&Number.isInteger(r.d)&&Number.isInteger(r.p)&&PBD[r.d]?.includes(r.p))put(r.g,r.block,r.slot,key(r.d,r.p));
  for(const k of matching){
    const [g,bc]=JSON.parse(k),cells=new Set(m.blocks.flatMap((r,i)=>r.grade===g&&r.block===bc?[...(positions.get(key('blocks',i))??[])]:[]));
    for(const cell of [...cells].sort()){const free=entries(b.slot).find(([[gg,bb,si]])=>gg===g&&bb===bc&&!bcells.get(k)?.has(si));if(free)put(g,bc,free[0][2],cell);}
  }
  for(const [[g,bc],cells] of entries(bcells))for(const [si,chosen] of cells)for(const [cell,v] of get(b.slot,g,bc,si))hint.set(v.name,Number(cell===chosen));
  m.blocks.forEach((r,i)=>{const ps=positions.get(key('blocks',i));if(ps)for(const [si,cell] of get(bcells,r.grade,r.block)??[])hint.set(get(b.y,i,si).name,Number(ps.has(cell)));});
  for(const [i,row] of b.banUnit){const ps=[...(positions.get(key('bans',i))??[])].sort();for(let j=0;j<Math.min(ps.length,row.units.length);j++){const u=row.units[j];hint.set(u.placed.name,1);for(const [cell,v] of u.cells)hint.set(v.name,Number(cell===ps[j]));}}
  return {hint,stats:{source:'previous_result',rowIds:source.size,matchedRowIds:matched.size,ignoredRowIds:source.size-matched.size,matchRate:source.size?matched.size/source.size:0,hintedVariables:hint.size}};
}
export function extractResult(m,b,solution){
  const positions=new Map(),blockSlots=[],SEC_PLACE=[],BAN_PLACE=[],UNPLACED=[];
  for(const [[g,block,slot],cells] of entries(b.slot))for(const [[d,p],v] of entries(cells))if(Number(solution[v.index])){set(positions,[g,block,slot],[d,p]);blockSlots.push({g,block,slot,d,p});}
  m.blocks.forEach((r,i)=>{for(let si=0;si<get(b.blocks,r.grade,r.block).len;si++)if(Number(solution[get(b.y,i,si).index])){const [d,p]=get(positions,r.grade,r.block,si);SEC_PLACE.push({g:r.grade,block:r.block,div:r.div,sub:r.subject,t:r.teacher,d,p,rowId:r.rowId});}});
  for(const [i,bu] of b.banUnit)for(const u of bu.units){const base={g:bu.g,cls:bu.cls,sub:bu.sub,t:bu.t,rowId:m.bans[i].rowId},hit=entries(u.cells).find(([,v])=>Number(solution[v.index]));if(hit){const [d,p]=hit[0];BAN_PLACE.push({...base,d,p});}else UNPLACED.push(base);}
  return {SEC_PLACE,BAN_PLACE,UNPLACED,blockSlots};
}

export function buildStage(m,options,api,{stage='1',bestPlaced, bestMax, hint=new Map(),warmStart}={}){
  const b=buildCpModel(m,options,api,{dailyMin:stage!=='0'}),E=api.LinearExpr;
  if(stage==='0'||stage==='1'){
    if(warmStart){const mapped=hintFromResult(m,warmStart,b);hint=mapped.hint;b.warmStart=mapped.stats;}applyHint(b,hint);if(b.total)b.cm.maximize(b.placed);else b.cm.minimize(0);
  }else{
    b.cm.add(b.total?E.from(b.placed).eq(bestPlaced):bestPlaced===0);applyHint(b,hint);
    const teachers=m.teachers.filter(t=>!m.gangsa.includes(t)),bounds=teachers.map(t=>scoreBounds(options.weights,m.teacherTotal[t]??0));
    b.pen=discomfortTerms(b,teacherOccupancy(b),teachers,options.weights,m.teacherTotal);
    b.maxpen=b.cm.newIntVar(Math.min(...bounds.map(x=>x[0]),...(bounds.length?[]:[0])),Math.max(...bounds.map(x=>x[1]),...(bounds.length?[]:[0])),'maxpen');
    for(const v of b.pen.values())b.cm.add(b.maxpen.ge(v));
    if(stage==='2')b.cm.minimize(b.maxpen);
    else{b.cm.add(b.maxpen.le(bestMax));b.totalpen=b.cm.newIntVar(bounds.reduce((a,x)=>a+x[0],0),bounds.reduce((a,x)=>a+x[1],0),'totpen');b.cm.add(b.totalpen.eq(E.sum(b.pen.values())));b.cm.minimize(b.totalpen);}
  }return b;
}

export const DEFAULT_OPTIONS={startLimit:0,weights:{over4:1,run3:1,lunch:1,firstlast:1},pairAllowList:[],gangsaDayCount:{},blockTimeBan:{},dependents:[{subject:'스포츠과학',follows:['음악감상과비평(2학년)','미술감상과비평(2학년)']},{subject:'공강(3학년)',follows:['운동과건강(3학년)']}]};
export function validateModel(model,overrides={},limits=[1800,600,120]){
  const errors=[],object=v=>!!v&&typeof v==='object'&&!Array.isArray(v),integer=Number.isInteger,range=(v,a,b)=>integer(v)&&v>=a&&v<=b;
  if(!object(model))return {model:null,options:null,errors:['모델은 JSON 객체여야 합니다.']};
  const m=structuredClone(model);
  if(m._type!=='시간표_솔버모델'||m._version!==1)errors.push('시간표_솔버모델 버전 1 JSON을 선택하세요.');
  for(const k of ['teachers','buja','gangsa','blocks','bans'])if(!Array.isArray(m[k]))errors.push(`${k}: 필수 배열이 없습니다.`);
  if(errors.length)return {model:null,options:null,errors};
  if(m.teachers.some(t=>typeof t!=='string'||!t.trim()))return {model:null,options:null,errors:['teachers: 교사 이름은 비어 있지 않은 문자열이어야 합니다.']};
  if(new Set(m.teachers).size!==m.teachers.length)errors.push('teachers: 비어 있거나 중복된 교사 이름입니다.');
  const options=structuredClone(DEFAULT_OPTIONS);
  for(const s of [Object.hasOwn(m,'options')?m.options:{},overrides??{}])if(object(s))Object.assign(options,s);else errors.push('options는 객체여야 합니다.');
  for(const role of ['buja','gangsa']){if(Object.hasOwn(options,role))m[role]=options[role];if(!Array.isArray(m[role])||m[role].some(t=>!m.teachers.includes(t)))errors.push(`${role}: teachers에 있는 이름의 배열이어야 합니다.`);options[role]=m[role];}
  if(typeof options.startLimit!=='number'||!Number.isFinite(options.startLimit)||options.startLimit<0||options.startLimit>86400)errors.push('0단계 제한 시간은 0~86400초 숫자여야 합니다.');
  if(!object(options.weights)||Object.values(options.weights).some(v=>!integer(v)||Math.abs(v)>1000000))errors.push('가중치는 절댓값 1000000 이하 정수여야 합니다.');
  if(!Array.isArray(options.pairAllowList)||options.pairAllowList.some(s=>typeof s!=='string'))errors.push('pairAllowList는 과목명 배열이어야 합니다.');
  if(!object(options.gangsaDayCount)||Object.entries(options.gangsaDayCount).some(([t,n])=>!Array.isArray(m.gangsa)||!m.gangsa.includes(t)||!range(n,1,5)))errors.push('강사 출근일수는 지정 강사의 1~5일 상한이어야 합니다.');
  if(!Array.isArray(options.dependents)||options.dependents.some(d=>!object(d)||typeof d.subject!=='string'||!Array.isArray(d.follows)||d.follows.some(s=>typeof s!=='string')))errors.push('dependents는 subject와 follows 배열을 가진 객체 배열이어야 합니다.');
  if(!object(options.blockTimeBan)||Object.values(options.blockTimeBan).some(cs=>!Array.isArray(cs)||cs.some(c=>!Array.isArray(c)||c.length!==2||!c.every(integer)||!PBD[c[0]]?.includes(c[1]))))errors.push('블록 금지 칸은 블록별 [요일 0~4, 교시] 배열이어야 합니다.');
  if(!Array.isArray(limits)||limits.length!==3||limits.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>86400))errors.push('단계 제한 시간은 0~86400초 숫자 3개여야 합니다.');options.limits=Array.isArray(limits)?[...limits]:[];
  if(!Array.isArray(Object.hasOwn(m,'flags')?m.flags:[])||(m.flags??[]).some(s=>typeof s!=='string'))errors.push('flags는 문자열 배열이어야 합니다.');
  else if((m.flags??[]).some(s=>s.includes('배치 초과')))errors.push('배치 초과: 교과배당표의 블록·교사 시수 합을 블록 길이 이내로 수정한 뒤 새 JSON을 내보내세요.');
  const lengths=new Map(),sums=new Map(),totals=new Map(),ids=new Set();
  for(const kind of ['blocks','bans'])m[kind].forEach((r,i)=>{
    const label=`${kind}[${i}]`,fields=['grade','subject','teacher','hours',...(kind==='blocks'?['block','blockLen','div']:['cls'])];
    if(!object(r)||fields.some(k=>!Object.hasOwn(r,k))){errors.push(label+': 필수 필드가 없습니다.');return;}
    if(!Object.hasOwn(r,'rowId'))r.rowId=`${kind}:${i}`;if(typeof r.rowId!=='string'||!r.rowId||ids.has(r.rowId))errors.push(label+': rowId는 고유한 문자열이어야 합니다.');else ids.add(r.rowId);
    if(!['1','2','3'].includes(r.grade)||!m.teachers.includes(r.teacher)||['subject','teacher',...(kind==='blocks'?['block','div']:['cls'])].some(k=>typeof r[k]!=='string'||!r[k])){errors.push(label+': 학년·교사·과목·학급/분반을 확인하세요.');return;}
    if(!range(r.hours,1,1000)){errors.push(label+': 시수는 1~1000 정수여야 합니다.');return;}totals.set(r.teacher,(totals.get(r.teacher)??0)+r.hours);
    if(kind==='blocks'){
      const k=key(r.grade,r.block);if(!range(r.blockLen,1,5)){errors.push(label+': blockLen은 1~5 정수여야 합니다.');return;}
      if(lengths.has(k)&&lengths.get(k)!==r.blockLen)errors.push(label+': blockLen 불일치');lengths.set(k,r.blockLen);
      for(const s of [key(k,'teacher',r.teacher),key(k,'section',r.div,r.subject)])sums.set(s,(sums.get(s)??0)+r.hours);
    }else if(Object.hasOwn(r,'art')&&typeof r.art!=='boolean')errors.push(label+': art는 불리언이어야 합니다.');
  });
  for(const [k,n] of sums)if(n>lengths.get(JSON.parse(k)[0]))errors.push('교사 또는 (div, 과목) 합이 blockLen을 초과합니다.');
  if(m.classes!==undefined&&m.classes!==null){
    if(!object(m.classes)||Object.entries(m.classes).some(([g,n])=>!['1','2','3'].includes(g)||!range(n,0,100)))errors.push('classes는 학년별 학급 수 객체여야 합니다.');
    else if(!errors.length){
      for(const r of m.blocks)if(m.classes[r.grade]===0)errors.push('이동수업의 학년에 학급이 없습니다.');
      for(const r of m.bans)if(!Object.hasOwn(m.classes,r.grade)||!Array.from({length:m.classes[r.grade]},(_,i)=>String(i+1)).includes(r.cls))errors.push('반수업의 학급이 classes에 없습니다.');
      for(const [g,n] of Object.entries(m.classes))for(let c=1;c<=n;c++){
        const h=m.bans.filter(r=>r.grade===g&&r.cls===String(c)).reduce((a,r)=>a+r.hours,0)+entries(lengths).filter(([[grade]])=>grade===g).reduce((a,[,n])=>a+n,0);
        if(h!==31)errors.push(`${g}-${c}: 주간 합 ${h}, 31이어야 합니다.`);
      }
    }
  }
  m.teacherTotal=Object.fromEntries(totals);return {model:m,options,errors};
}

const statusName=s=>typeof s==='number'?['UNKNOWN','MODEL_INVALID','FEASIBLE','INFEASIBLE','OPTIMAL'][s]??'UNKNOWN':s??'UNKNOWN';
const sortedJSON=v=>Array.isArray(v)?v.map(sortedJSON):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortedJSON(v[k])])):v;
export async function solveTimetable(model,overrides={},api,{limits=[1800,600,120],warmStart,signal,onProgress,workers,executor='direct'}={}){
  const checked=validateModel(model,overrides,limits),m=checked.model,options=checked.options;
  try{if(warmStart!==undefined&&warmStart!==null)validateWarmStart(warmStart);}catch(e){checked.errors.push(e.message);}
  const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(sortedJSON(model))));
  const result={modelHash:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),options:options??overrides,stages:[],checker:{ok:null,status:'미실행',errors:[]},status:'UNKNOWN',adoptedStage:null};
  if(checked.errors.length)return {...result,status:'VALIDATION_ERROR',errors:checked.errors};
  let hint=new Map(),strictHint=new Map(),bestPlaced,bestMax;
  const initial={stage:'0',relaxed:'daily_min',status:'SKIPPED',objective:null,wall_time:0,adopted:false};result.stages.push(initial);
  const progress=(type,stage,extra={})=>onProgress?.({type,state:'실행 중',stage,stages:structuredClone(result.stages),...extra});
  const run=async(b,name,limit)=>{
    progress('stage-start',name);const bytes=await api.CpSat.createModel(b.cm.modelProto);
    const response=await api.CpSat.solveProto(bytes,{executor,signal,maxTimeInSeconds:limit,numWorkers:workers??(name==='0'||name==='1'?16:8),...(name==='0'||name==='1'?{numViolationLs:1}:{}),logSearchProgress:false,logToStdout:false,eventMask:{solution:true,bestBound:false,log:false},onEvent:e=>{if(e.type==='solution')progress('solution',name,{objective:e.response.objectiveValue,wall_time:e.response.wallTime});}});
    const r=response.response??{},status=statusName(r.status),valid=status==='OPTIMAL'||status==='FEASIBLE';
    return {r,valid,stage:{stage:name,status,objective:valid?r.objectiveValue??0:null,wall_time:r.wallTime??0,adopted:false}};
  };
  try{
    if(signal?.aborted){result.status='CANCELLED';return result;}
    if(warmStart)initial.reason='previous_result';
    else if(options.startLimit>0){
      const b=buildStage(m,options,api,{stage:'0'}),out=await run(b,'0',options.startLimit);Object.assign(initial,out.stage);progress('stage-end','0');
      if(out.valid)hint=captureHint(b,out.r.solution);result.warmStart={source:'relaxed_daily_min',hintedVariables:hint.size};
    }else initial.reason='zero_limit';
    for(const [i,name] of ['1','2','2.5'].entries()){
      if(signal?.aborted){result.status='CANCELLED';break;}
      if(i&&(limits[i]===0||(i===2&&bestMax===undefined))){result.stages.push({stage:name,status:'SKIPPED',objective:null,wall_time:0,adopted:false});continue;}
      const b=buildStage(m,options,api,{stage:name,bestPlaced,bestMax,hint:i?strictHint:hint,warmStart:i?undefined:warmStart});
      if(b.warmStart)result.warmStart=b.warmStart;
      const out=await run(b,name,limits[i]);result.stages.push(out.stage);
      if(out.valid){
        for(const s of result.stages)s.adopted=false;out.stage.adopted=true;
        Object.assign(result,extractResult(m,b,out.r.solution),{status:'SUCCESS',adoptedStage:name,total:b.total,placed:[...b.banUnit.values()].flatMap(row=>row.units).reduce((n,u)=>n+Number(out.r.solution[u.placed.index]),0)});
        if(i===0){bestPlaced=result.placed;strictHint=captureHint(b,out.r.solution,{includeBans:false});}
        else if(i===1)bestMax=Number(out.r.solution[b.maxpen.index]);
        if(b.pen)result.scores=Object.fromEntries([...b.pen].map(([t,v])=>[t,Number(out.r.solution[v.index])]));
      }else if(i===0){result.status=out.stage.status;progress('stage-end',name);break;}
      progress('stage-end',name);
    }
  }catch(error){if(signal?.aborted||error.name==='AbortError')result.status='CANCELLED';else throw error;}
  if(result.BAN_PLACE){
    if(!result.scores)result.scores=checkTimetable(m,result,options).scores;
    result.checker=checkTimetable(m,result,options);if(!result.checker.ok&&result.status==='SUCCESS')result.status='검증 실패';
  }return result;
}
