// Independent of the model builder and WASM runtime.
const PBD=[[2,3,4,5,6,7],[1,2,3,4,5,6,7],[1,2,3,4],[1,2,3,4,5,6,7],[1,2,3,4,5,6,7]];
const RT={'1':[0,1,2,3,4,6,7,8],'2':[0,1,2,3,4,6,7,8],'3':[0,1,2,3,5,6,7,8]};
const CELLS=PBD.flatMap((ps,d)=>ps.map(p=>[d,p])),key=(...k)=>JSON.stringify(k);
const valid=(d,p)=>Number.isInteger(d)&&Number.isInteger(p)&&!!PBD[d]?.includes(p);
const inc=(m,...k)=>m.set(key(...k),(m.get(key(...k))??0)+1),count=(m,...k)=>m.get(key(...k))??0;
const pairs=n=>[...new Set([[1,2,3,4,6,7,8],[1,2,3,5,6,7,8]].flatMap(r=>r.slice(0,r.length-n+1).map((_,i)=>key(...r.slice(i,i+n)))))].map(JSON.parse);
export function checkTimetable(model,result,options={}){
  const errors=new Set(),require=(ok,msg)=>{if(!ok)errors.add(msg);},source=new Map();
  for(const kind of ['blocks','bans'])model[kind].forEach((r,i)=>source.set(r.rowId??`${kind}:${i}`,[kind,r]));
  const lengths=new Map(model.blocks.map(r=>[key(r.grade,r.block),r.blockLen])),slotBy=new Map(),gradeBlock=new Map(),seen=new Set();
  for(const r of result.blockSlots??[]){
    if(!r||!['g','block','slot','d','p'].every(k=>Object.hasOwn(r,k))){errors.add('블록 슬롯 형식 오류');continue;}
    const {g,block:bc,slot:si,d,p}=r,k=key(g,bc);
    require(lengths.has(k)&&Number.isInteger(si)&&si>=0&&si<lengths.get(k),'未知 블록 슬롯');require(valid(d,p),'블록 시간 범위');
    require(!seen.has(key(g,bc,si)),'블록 슬롯 번호 중복');seen.add(key(g,bc,si));
    if(!slotBy.has(k))slotBy.set(k,[]);slotBy.get(k).push([d,p]);inc(gradeBlock,g,d,p);
    require(!(options.blockTimeBan?.[bc]??[]).some(c=>key(...c)===key(d,p)),'블록 금지 칸');
  }
  for(const [k,n] of lengths){const cells=slotBy.get(k)??[];require(cells.length===n&&new Set(cells.map(c=>c[0])).size===n,'블록 슬롯 수/하루 1회');}
  require([...gradeBlock.values()].every(v=>v===1),'동일 학년 블록 중복');
  const occupancy=new Map(),sections=new Map(),classes=new Map(),hours=new Map(),groups=new Map(),moving=new Set();
  for(const [kind,k] of [['blocks','SEC_PLACE'],['bans','BAN_PLACE'],['bans','UNPLACED']])for(const r of result[k]??[]){
    try{
      if(!r||!source.has(r.rowId))throw Error();const [originalKind,o]=source.get(r.rowId);
      require(originalKind===kind,'배당행 종류 불일치');
      const fields=[['g','grade'],['sub','subject'],['t','teacher'],...(kind==='blocks'?[['block','block'],['div','div']]:[['cls','cls']])];
      if(fields.some(([a])=>!Object.hasOwn(r,a)))throw Error();require(fields.every(([a,b])=>r[a]===o[b]),'배당행 내용 변조');
      if(k==='UNPLACED'){require(false,'미배치 시수 존재');continue;}
      const {d,p,g,t}=r;require(valid(d,p),'수업 시간 범위');if(!RT[g]?.[p])throw Error();
      inc(occupancy,t,d,RT[g][p]);inc(hours,r.rowId);
      if(kind==='blocks'){
        require((slotBy.get(key(g,r.block))??[]).some(c=>key(...c)===key(d,p)),'이동수업과 블록 슬롯 불일치');
        inc(sections,g,r.block,r.div,r.sub,d,p);moving.add(key(g,r.sub,d,p));
      }else{
        inc(classes,g,r.cls,d,p);const k=key(g,r.cls,r.sub,t,!!o.art);if(!groups.has(k))groups.set(k,[]);groups.get(k).push([d,p]);
        if((options.buja??model.buja).includes(t)&&!r.sub.includes('진로'))require(d!==4||p!==1,'부장 금1');
        if(g==='3'&&r.sub.includes('진로'))require(d===4&&p===1,'3학년 진로 금1');
      }
    }catch{errors.add('결과 행 형식/rowId 오류');}
  }
  require([...occupancy.values()].every(v=>v===1),'교사 실제 시간 중복');require([...sections.values()].every(v=>v===1),'동일 (div, 과목) 슬롯 중복');
  for(const [rid,[,row]] of source)require(count(hours,rid)===row.hours,'배당행 시수 불일치: '+rid);
  const classSet=new Set(model.bans.map(r=>key(r.grade,r.cls)));
  for(const [g,n] of Object.entries(model.classes??{}))for(let c=1;c<=n;c++)classSet.add(key(g,String(c)));
  for(const k of classSet){const [g,c]=JSON.parse(k);for(const [d,p] of CELLS)require(count(classes,g,c,d,p)+count(gradeBlock,g,d,p)===1,'학급 31칸 빈칸/중복');}
  const gangsa=new Set(options.gangsa??model.gangsa);
  for(const [k,cells] of groups){
    const [g,cls,sub,t,art]=JSON.parse(k),daily=[0,0,0,0,0];for(const [d] of cells)daily[d]++;
    if(art){const n=cells.filter(([d,p])=>p!==4&&PBD[d]?.includes(p+1)&&cells.some(([e,q])=>d===e&&q===p+1)).length;require(Math.max(...daily)<=2&&n===1,'미술 2+1 연강');}
    else if(!gangsa.has(t)){
      const allow=options.pairAllowList?.includes(sub);require(Math.max(...daily)<=(allow?2:1),'하루 과목 횟수');
      if(allow)require(cells.every(([d,p],i)=>cells.slice(i+1).every(([e,q])=>d!==e||Math.abs(p-q)>=3)),'하루 2회 교시 차이 3 이상');
    }
  }
  for(const dep of options.dependents??[])for(const k of moving){const [g,sub,d,p]=JSON.parse(k);if(sub===dep.subject)require(!dep.follows.some(s=>moving.has(key(g,s,d,p))),'종속 과목 중복');}
  const scores={};
  for(const t of model.teachers){
    const actual=new Set([...occupancy.keys()].map(JSON.parse).filter(([name])=>name===t).map(([,d,rt])=>key(d,rt))),has=(d,rt)=>actual.has(key(d,rt));
    if(gangsa.has(t)){require(new Set([...actual].map(k=>JSON.parse(k)[0])).size<=(options.gangsaDayCount?.[t]??5),'강사 출근일수 상한');continue;}
    const first=[1,2,3,4].filter(d=>has(d,1)).length,last=[0,1,3,4].filter(d=>has(d,8)).length;
    require(first>=2&&first<=3&&last>=2&&last<=3,'일반교사 1·7교시 일수');
    const candidates=new Set([...model.blocks,...model.bans].filter(r=>r.teacher===t).flatMap(r=>CELLS.map(([d,p])=>key(d,RT[r.grade][p]))));
    const daily=Array.from({length:5},(_,d)=>[...actual].map(JSON.parse).filter(([e])=>d===e).length);
    for(let d=0;d<5;d++){
      if([...candidates].some(k=>JSON.parse(k)[0]===d))require(daily[d]>=2&&daily[d]<=[4,5,3,5,5][d],'일반교사 요일별 시수');
      require(!(has(d,4)&&has(d,5)),'점심 보장');require(!pairs(4).some(ch=>ch.every(rt=>has(d,rt))),'최대 3연강');
    }
    let lunches=0,runs=0;for(let d=0;d<5;d++){if((has(d,4)&&has(d,6))||(has(d,3)&&has(d,5)))lunches++;runs+=pairs(3).filter(ch=>ch.every(rt=>has(d,rt))).length;}
    const w=k=>options.weights?.[k]??1,step=n=>n===0?0:2**(Math.min(n,5)-1);
    let value=w('over4')*(daily.reduce((a,b)=>a+b,0)-22);
    if([1,2,3,4].some(d=>candidates.has(key(d,1))))value+=w('firstlast')*(first-2);
    if([0,1,3,4].some(d=>candidates.has(key(d,8))))value+=w('firstlast')*(last-2);
    value+=w('lunch')*step(lunches)+w('run3')*step(runs);Object.defineProperty(scores,t,{value,enumerable:true,configurable:true});
  }
  require(!!result.scores&&Object.keys(scores).length===Object.keys(result.scores).length&&Object.entries(scores).every(([t,v])=>result.scores[t]===v),'불편 점수 재계산 불일치');
  return {ok:!errors.size,status:errors.size?'검증 실패':'검증 통과',errors:[...errors].sort(),scores};
}
export const check=checkTimetable;
