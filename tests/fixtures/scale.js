import * as C from '../../shared/domain.js';
export function scaleState(departmentCount=12){
  const state={schemaVersion:1,uiVersion:3,school:{name:'가상규모시험학교',year:2026,semester:1,grades:[1,2,3].map(grade=>({grade,classCount:10,movingCount:6}))},source:{fixture:true},customCatalog:[],departments:[],teachers:[],courses:[],groups:[],assignments:[],unmapped:[],history:[]};
  for(let d=1;d<=departmentCount;d++){
    const id='d'+d;state.departments.push({id,name:'가상교과'+d,status:'draft',sourceTotal:null,note:''});
    for(let t=0;t<12;t++)state.teachers.push({id:id+'-t'+t,deptId:id,name:'가상교사'+d+'-'+t,targetHours:null,sourceTotal:null});
    for(let c=0;c<8;c++){
      const courseId=id+'-c'+c;state.courses.push({id:courseId,deptId:id,name:'가상과목'+c,grade:2,baseHours:3,credits:3,kind:'subject'});
      for(let g=0;g<6;g++){
        const groupId=courseId+'-g'+g,sectionId=groupId+'-s',label='2'+String.fromCharCode(65+g);
        state.groups.push({id:groupId,courseId,label,kind:'moving',legacy:[],slots:[{id:sectionId,label,hours:3}],review:false,sourceHours:null,sourceCell:null});
        state.assignments.push({teacherId:id+'-t'+((c*6+g)%12),sectionId,hours:3});
      }
    }
  }
  return C.assertState(state);
}
