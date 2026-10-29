import * as C from '../../shared/domain.js';
import * as S from '../../shared/state.js';
import {createHash} from 'node:crypto';
export function demoState(){
  const state={schemaVersion:1,uiVersion:3,school:{name:'가상고등학교',year:2026,semester:1,grades:[1,2,3].map(grade=>({grade,classCount:2,movingCount:2}))},source:{fixture:true},customCatalog:[],
    departments:[{id:'d1',name:'가상국어',status:'draft',sourceTotal:null,note:''},{id:'d2',name:'가상수학',status:'draft',sourceTotal:null,note:''}],teachers:[],courses:[],groups:[],assignments:[],unmapped:[],history:[]};
  for(const [i,d] of state.departments.entries()){
    const course={id:'course-'+d.id,deptId:d.id,name:i?'가상수학 과목':'가상국어 과목',grade:2,baseHours:3,credits:3,kind:'subject'};
    const teacher={id:'teacher-'+d.id,deptId:d.id,name:'가상교사'+(i+1),targetHours:null,sourceTotal:null,isLead:false,rows:[{id:'row-'+d.id,courseId:course.id}]};
    state.courses.push(course);state.teachers.push(teacher);
    state.groups.push({id:'group-'+d.id,courseId:course.id,label:'2A',kind:'moving',legacy:[],slots:[{id:'section-'+d.id,label:'2A',hours:3}],review:false,sourceHours:null,sourceCell:null});
    state.assignments.push({sectionId:'section-'+d.id,teacherId:teacher.id,hours:3});
  }
  return C.assertState(state);
}
export function demoSeed(){
  const state=demoState(),quote=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'";
  return 'DELETE FROM sheets;\nUPDATE workspace SET payload='+quote(S.globalPart(state))+', revision=1 WHERE id=1;\n'+state.departments.map(d=>{const part=S.departmentPart(state,d.id),hash=createHash('sha256').update(S.identityKey(part)).digest('hex');return 'INSERT INTO sheets(id,payload,identity_hash) VALUES (\''+d.id+'\','+quote(part)+',\''+hash+'\');';}).join('\n')+'\n';
}
export function hoursFixture(){return {format:'school-course-hours',schemaVersion:1,hoursUnit:'weekly-periods',includesStudentData:false,exportedAt:'2026-10-29T00:00:00Z',source:{toolVersion:'19'},sheets:[{sheetId:'virtual-sheet',sourceSheetName:'가상배정',grade:2,academicYear:2026,semester:1,validation:{complete:true,hardConstraintsPassed:true,coupledCohortsPassed:true},courses:[{courseId:'virtual-course',courseName:'가상추가 과목',subjectGroup:'korean',credits:3,weeklyHours:3,sectionCount:1,totalWeeklyHours:3,sections:[{sectionId:'virtual-section',sectionCode:'A',timeBlock:'A',weeklyHours:3}]}],coupledCohorts:[]}]};}
