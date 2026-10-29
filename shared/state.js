const baselineTexts=new WeakMap();
function same(a,b){
  let text;if(b&&typeof b==='object'){text=baselineTexts.get(b);if(text===undefined){text=JSON.stringify(b);baselineTexts.set(b,text);}}else text=JSON.stringify(b);
  return JSON.stringify(a)===text;
}
function globalPart(s){return {schemaVersion:1,uiVersion:3,school:s.school,source:s.source??{},customCatalog:s.customCatalog??[],departmentIds:s.departments.map(d=>d.id)};}
const indexedStates=new WeakMap();
function parts(s){
  let result=indexedStates.get(s);if(result)return result;
  result=new Map(s.departments.map(department=>[department.id,{department,teachers:[],courses:[],groups:[],assignments:[],unmapped:[]}]));
  const courses=new Map(),sections=new Map();
  for(const t of s.teachers)result.get(t.deptId).teachers.push(t);
  for(const c of s.courses){result.get(c.deptId).courses.push(c);courses.set(c.id,c.deptId);}
  for(const g of s.groups){const id=courses.get(g.courseId);result.get(id).groups.push(g);for(const slot of g.slots)sections.set(slot.id,id);}
  for(const a of s.assignments)result.get(sections.get(a.sectionId)).assignments.push(a);
  for(const u of s.unmapped)result.get(u.deptId).unmapped.push(u);
  indexedStates.set(s,result);return result;
}
function departmentPart(s,id){const part=parts(s).get(id);if(!part)throw new Error('교과군을 찾을 수 없습니다.');return part;}
function rememberParts(s,ordered){indexedStates.set(s,new Map(ordered.map(p=>[p.department.id,p])));return s;}
function invalidateParts(s){indexedStates.delete(s);}
function identityKey(part){return JSON.stringify([
  ...part.teachers.map(x=>'teacher:'+x.id),...part.courses.map(x=>'course:'+x.id),
  ...part.groups.map(x=>'group:'+x.id),...part.groups.flatMap(g=>g.slots.map(x=>'section:'+x.id)),
  ...part.unmapped.map(x=>'unmapped:'+x.id)
].sort());}
export {same,globalPart,departmentPart,parts,rememberParts,invalidateParts,identityKey};
