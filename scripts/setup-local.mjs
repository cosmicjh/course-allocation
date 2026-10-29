import {writeFile,access} from 'node:fs/promises';
import {provisionCredential,randomToken} from '../server/crypto.js';
import {demoSeed,demoState,hoursFixture} from '../tests/fixtures/demo.js';
try{if(process.argv.includes('--reset-demo'))throw new Error('reset demo');await access('.dev.vars');console.log('기존 .dev.vars 유지');}
catch{const pepper=randomToken();await writeFile('.dev.vars','PASSWORD_PEPPER="'+pepper+'"\nBOOTSTRAP_ACCESS_HASH="'+await provisionCredential('virtual-access-2026',pepper,'access')+'"\nBOOTSTRAP_ADMIN_HASH="'+await provisionCredential('virtual-admin-2026',pepper,'admin')+'"\n');console.log('로컬 가상 비밀번호 설정 생성');}
await writeFile('tests/fixtures/demo.sql',demoSeed());
await writeFile('tests/fixtures/course-hours.json',JSON.stringify(hoursFixture(),null,2)+'\n');
await writeFile('tests/fixtures/demo-backup.json',JSON.stringify(demoState(),null,2)+'\n');
console.log('가상 시험 자료 생성. 접속: virtual-access-2026 / 관리자: virtual-admin-2026');
