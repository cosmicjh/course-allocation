import * as C from '../../shared/domain.js';

export function solverState(){
  const state={schemaVersion:1,uiVersion:3,school:{name:'가상고등학교',year:2026,semester:2,grades:[1,2,3].map(grade=>({grade,classCount:grade===3?1:0,movingCount:1}))},departments:[{id:'art',name:'미술',status:'draft'}],teachers:[],courses:[],groups:[],assignments:[],unmapped:[],history:[],departmentRevisions:{art:7}};
  const first=C.addTeacher(state,'art','가상교사'),second=C.addTeacher(state,'art','가상강사');first.isLead=true;
  const course=C.addCourse(state,{deptId:'art',name:'통합사회',grade:3,baseHours:28});
  const ban=C.addGroup(state,course.id,'3-1','homeroom',28);
  C.setAssignment(state,ban.slots[0].id,first.id,14);C.setAssignment(state,ban.slots[0].id,second.id,14);
  const moving=C.addCourse(state,{deptId:'art',name:'통합사회2',grade:3,baseHours:3});
  C.addGroup(state,moving.id,'3A','moving',3);
  const group=C.setSectionPlan(state,moving.id,{grade:3,label:'3A',kind:'moving'},[{label:'3A1',hours:3},{label:'3A2',hours:2}]);
  C.setAssignment(state,group.slots[0].id,first.id,3);C.setAssignment(state,group.slots[1].id,second.id,2);
  C.changeStatus(state,'art','submitted');C.changeStatus(state,'art','locked');
  return C.assertState(state);
}
