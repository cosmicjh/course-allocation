import * as C from "./domain.js";
const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const parentOrder=group=>{const grade=Number(group.label[0]);if(group.kind==='homeroom')return grade*10000+Number(group.label.split('-')[1]);let n=0;for(const ch of group.label.slice(1))n=n*26+ch.charCodeAt(0)-64;return grade*10000+1000+n;};

function blankFormModel(state,deptId){
  const department=state.departments.find(d=>d.id===deptId);if(!department)throw new Error('인쇄할 교과군을 찾을 수 없습니다.');
  const courses=C.coursesOf(state,deptId),columns=[];
  for(const grade of [...state.school.grades].sort((a,b)=>a.grade-b.grade)){
    for(let i=1;i<=grade.classCount;i++)columns.push({label:`${grade.grade}-${i}`,grade:grade.grade,caption:String(i)});
    for(let i=1;i<=grade.movingCount;i++){const label=`${grade.grade}${C.letter(i)}`;columns.push({label,grade:grade.grade,caption:label});}
  }
  const notes=[];
  const plans=courses.map(course=>{
    const gs=C.groupsOf(state,course.id),lookup=new Map(gs.map(g=>[g.label,C.sum(g.slots.map(s=>s.hours))]));
    const sections=gs.filter(C.isSplitGroup).sort((a,b)=>parentOrder(a)-parentOrder(b)).map(g=>({parent:g.label,slots:g.slots.map(s=>({label:s.label,hours:s.hours})),total:lookup.get(g.label)}));
    if(sections.length)notes.push({course:course.name,grade:course.grade,sections});
    return {name:course.name,grade:course.grade,hours:columns.map(col=>lookup.get(col.label)??null),total:C.sum([...lookup.values()]),split:columns.map(col=>sections.some(g=>g.parent===col.label))};
  });
  const teacherCount=Math.max(1,C.teachersOf(state,deptId).length);
  return {department:department.name,school:state.school.name,year:state.school.year,semester:state.school.semester,columns,plans,notes,teacherCount,rowsPerTeacher:4,blankRowCount:teacherCount*4};
}

const textUnits=value=>[...String(value)].reduce((sum,ch)=>sum+(/[\u1100-\uffff]/.test(ch)?1:.58),0);
function wrapReference(value,width,size){
  const lines=[];let line='';
  for(const word of value.split(/\s+/)){const candidate=line?line+' '+word:word;if(line&&textUnits(candidate)*size>width){lines.push(line);line=word;}else line=candidate;}
  if(line)lines.push(line);return lines;
}

function currentFormModel(state,deptId,unsaved=false){
  const model=blankFormModel(state,deptId),extraNotes=[],teachers=C.teachersOf(state,deptId).map((teacher,ti)=>{
    const rows=C.teacherRows(state,teacher.id).map(row=>{
      const course=state.courses.find(c=>c.id===row.courseId),groups=course?C.groupsOf(state,course.id):[];
      const values=model.columns.map(column=>{
        const group=groups.find(g=>g.label===column.label);if(!group)return {hours:null,split:false,pending:false};
        const allocations=group.slots.map(slot=>({label:slot.label,hours:C.sum(state.assignments.filter(a=>a.teacherId===teacher.id&&a.sectionId===slot.id).map(a=>a.hours))})).filter(a=>a.hours);
        const pending=C.sum(group.legacy.filter(a=>a.teacherId===teacher.id).map(a=>a.hours)),hours=C.sum(allocations.map(a=>a.hours))+pending,split=C.isSplitGroup(group);
        if(hours&&split)extraNotes.push(`${C.teacherLabel(teacher,ti)} · ${course.name} (${course.grade}학년) ${group.label}: ${pending?pending+'시간 (실제 분반 미지정)':allocations.map(a=>a.label+' '+a.hours+'시간').join(' + ')}`);
        else if(pending)extraNotes.push(`${C.teacherLabel(teacher,ti)} · ${course.name} ${group.label}: ${pending}시간 (실제 분반 미지정)`);
        return {hours:hours||null,split,pending:Boolean(pending)};
      });
      return {courseId:course?.id||'',name:course?`${course.name} (${course.grade}학년)`:'',values,total:C.sum(values.map(v=>v.hours||0))};
    });
    const unmatched=state.unmapped.filter(u=>u.teacherId===teacher.id&&u.deptId===deptId);
    if(unmatched.length)extraNotes.push(`${C.teacherLabel(teacher,ti)} · 과목 미연결 원본(교사 합계에 포함): ${unmatched.map(u=>`${u.sourceName} (${u.grade}학년) ${u.label} ${u.hours}시간`).join(' / ')}`);
    return {id:teacher.id,name:teacher.name,isLead:Boolean(teacher.isLead),rows,total:C.teacherHours(state,teacher.id)};
  });
  if(!teachers.length)teachers.push({id:'',name:'',isLead:false,rows:[{name:'',values:model.columns.map(()=>({hours:null,split:false,pending:false})),total:0}],total:0});
  return {...model,filled:true,unsaved:Boolean(unsaved),teachers,teacherCount:teachers.length,rowCount:C.sum(teachers.map(t=>t.rows.length)),blankRowCount:C.sum(teachers.map(t=>t.rows.filter(r=>!r.name).length)),extraNotes};
}

function formSvg(model){
  const W=2810,H=1900,left=175,subject=350,total=105,start=120,gap=24,header=60,bodyRows=model.filled?model.rowCount:model.blankRowCount;
  const n=model.columns.length,cw=(W-left-subject-total)/Math.max(1,n),xSubject=left,xClasses=left+subject,xTotal=W-total;
  const referenceLines=[...model.notes.map(note=>`${note.course} (${note.grade}학년) | ${note.sections.map(g=>`${g.parent}: ${g.slots.map(s=>`${s.label} ${s.hours}시간`).join(' + ')} (합계 ${g.total}시간)`).join(' / ')}`),...(model.extraNotes||[])].flatMap(line=>wrapReference(line,W-48,22));
  const referenceScale=Math.min(1,440/Math.max(1,56+referenceLines.length*30)),referenceBoxHeight=(56+referenceLines.length*30)*referenceScale,referenceHeight=referenceLines.length?24+referenceBoxHeight:0;
  const budget=H-start-40-header*2-gap-referenceHeight,scale=Math.min(1,budget/(model.plans.length*30+bodyRows*20)),planHeight=30*scale,rowHeight=Math.min(64,(budget-model.plans.length*planHeight)/bodyRows);
  const shapes=[],text=[];
  const rect=(x,y,w,h,fill='white',stroke='#777')=>shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`);
  const label=(value,x,y,width,size=24,anchor='middle')=>{
    const content=String(value??'');if(!content)return;
    const estimate=textUnits(content)*size,available=Math.max(4,width-12),fit=estimate>available?` textLength="${available}" lengthAdjust="spacingAndGlyphs"`:'';
    text.push(`<text x="${anchor==='start'?x+6:x+width/2}" y="${y}" font-size="${size}" text-anchor="${anchor}" dy="${size*.35}"${fit}>${escape(content)}</text>`);
  };
  const cell=(x,y,w,h,value='',fill='white',size=24)=>{rect(x,y,w,h,fill);label(value,x,y+h/2,w,Math.min(size,h*.72));};
  text.push(`<text x="${W/2}" y="40" font-size="40" font-weight="600" text-anchor="middle">${escape(model.department)} 교과 시수배당 ${model.filled?'입력 내용':'입력 양식'}</text>`);
  label(`${model.school?model.school+' · ':''}${model.year}학년도 ${model.semester}학기`,0,86,W,24,'start');
  if(model.filled)text.push(`<text x="${W}" y="86" font-size="22" text-anchor="end" dy="7.7">${model.unsaved?'현재 입력본 · 미저장 내용 포함':'현재 입력본'}</text>`);
  let y=start;
  const headers=(first,second)=>{
    cell(0,y,left,header,first,'#efefef');cell(xSubject,y,subject,header,second,'#efefef');
    const bands=[];for(const col of model.columns){const band=bands.at(-1);if(band?.grade===col.grade)band.count++;else bands.push({grade:col.grade,count:1});}
    let offset=0;for(const band of bands){cell(xClasses+offset*cw,y,band.count*cw,26,`${band.grade}학년`,'#efefef',20);offset+=band.count;}
    model.columns.forEach((col,i)=>cell(xClasses+i*cw,y+26,cw,34,col.caption,'#efefef',23));cell(xTotal,y,total,header,'합계','#efefef');y+=header;
  };
  headers('학년','개설 과목');
  for(const plan of model.plans){cell(0,y,left,planHeight,`${plan.grade}학년`);cell(xSubject,y,subject,planHeight,plan.name,'white',25);plan.hours.forEach((hours,i)=>cell(xClasses+i*cw,y,cw,planHeight,hours??'',plan.split[i]?'#dedede':hours===null?'#fafafa':'white'));cell(xTotal,y,total,planHeight,plan.total);y+=planHeight;}
  y+=gap;headers('교사명','담당 과목');
  const blankStart=y;
  if(model.filled){
    for(const teacher of model.teachers){
      const teacherY=y,blockHeight=rowHeight*teacher.rows.length;
      rect(0,y,left,blockHeight);rect(xTotal,y,total,blockHeight);
      label(teacher.name,0,y+blockHeight/2-(teacher.isLead?Math.min(12,blockHeight*.16):0),left,Math.min(26,blockHeight*(teacher.isLead?.35:.72)));
      if(teacher.isLead)label('부장',0,y+blockHeight/2+Math.min(20,blockHeight*.22),left,Math.min(18,blockHeight*.25));
      label(teacher.total||'',xTotal,y+blockHeight/2,total,Math.min(26,blockHeight*.72));
      for(const row of teacher.rows){
        cell(xSubject,y,subject,rowHeight,row.name,'white',23);
        row.values.forEach((value,i)=>cell(xClasses+i*cw,y,cw,rowHeight,value.hours===null?'':String(value.hours)+(value.pending?'*':''),value.split?'#dedede':'white',24));
        y+=rowHeight;
      }
      shapes.push(`<path d="M0 ${teacherY}H${W}" fill="none" stroke="#555" stroke-width="1.6"/>`);
    }
  }else{
  for(let t=0;t<model.teacherCount;t++){
    const teacherY=y;rect(0,y,left,rowHeight*4);rect(xTotal,y,total,rowHeight*4);
    for(let row=0;row<4;row++){rect(xSubject,y,subject,rowHeight);for(let i=0;i<n;i++)rect(xClasses+i*cw,y,cw,rowHeight);y+=rowHeight;}
    shapes.push(`<path d="M0 ${teacherY}H${W}" fill="none" stroke="#555" stroke-width="1.6"/>`);
  }
  }
  shapes.push(`<rect x="0" y="${blankStart}" width="${W}" height="${y-blankStart}" fill="none" stroke="#555" stroke-width="1.6"/>`);
  if(referenceLines.length){
    y+=24;
    shapes.push(`<rect x="1.5" y="${y}" width="${W-3}" height="${referenceBoxHeight}" fill="#fafafa" stroke="#444" stroke-width="3"/>`);
    shapes.push(`<rect x="3" y="${y+1.5}" width="${W-6}" height="${36*referenceScale-1.5}" fill="#eaeaea"/>`);
    shapes.push(`<path d="M1 ${y+36*referenceScale}H${W-1}" fill="none" stroke="#aaa" stroke-width="1"/>`);
    text.push(`<text x="20" y="${y+18*referenceScale}" font-size="${25*referenceScale}" font-weight="600" dy="${25*referenceScale*.35}">참고사항</text>`);y+=36*referenceScale;
    for(const line of referenceLines){label(line,14,y+15*referenceScale,W-28,22*referenceScale,'start');y+=30*referenceScale;}y+=20*referenceScale;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="blank-print-sheet${model.filled?' filled-print-sheet':''}" role="img" aria-label="${escape(model.department)} ${model.filled?'현재 입력 내용':'빈 시수배당 양식'}" viewBox="0 0 ${W} ${H}" width="281mm" height="190mm" data-teachers="${model.teacherCount}" data-blank-rows="${model.blankRowCount}" data-rows="${bodyRows}" data-content-bottom="${y}" style="font-family:'Pretendard Variable',Pretendard,'Malgun Gothic','Apple SD Gothic Neo','Noto Sans CJK KR',sans-serif;color:#111"><title>${escape(model.department)} 시수배당 ${model.filled?'입력 내용':'입력 양식'}</title><g>${shapes.join('')}</g><g fill="#111">${text.join('')}</g></svg>`;
}

function blankFormSvg(state,deptId){return formSvg(blankFormModel(state,deptId));}
function currentFormSvg(state,deptId,unsaved=false){return formSvg(currentFormModel(state,deptId,unsaved));}
export {blankFormModel,blankFormSvg,currentFormModel,currentFormSvg};
