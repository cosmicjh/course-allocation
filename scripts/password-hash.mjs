import {provisionCredential,randomToken} from '../server/crypto.js';
import {readFile} from 'node:fs/promises';
if(process.argv.includes('--generate-pepper')){console.log(randomToken());process.exit(0);}
const kind=process.argv.includes('--admin')?'admin':'access';
let pepper=process.env.PASSWORD_PEPPER;
if(!pepper){try{pepper=(await readFile('.dev.vars','utf8')).replace(/\r\n/g,'\n').match(/^PASSWORD_PEPPER="?([a-f0-9]{64})"?$/m)?.[1];}catch{}}
if(!/^[a-f0-9]{64}$/.test(pepper||''))throw new Error('PASSWORD_PEPPER 환경 변수 또는 로컬 .dev.vars 설정이 필요합니다.');
if(process.argv[2]==='--stdin'){
  let text='';for await(const chunk of process.stdin)text+=chunk;
  const password=text.replace(/\r?\n$/,'');if(password.length<8||password.length>128)throw new Error('8~128자 비밀번호가 필요합니다.');
  console.log(await provisionCredential(password,pepper,kind));
}else{
  const {createInterface}=await import('node:readline');
  if(!process.stdin.isTTY)throw new Error('파이프로 입력하려면 --stdin을 지정하세요.');
  process.stdout.write('새 비밀번호 (화면에 표시되지 않음): ');
  const readline=createInterface({input:process.stdin,output:process.stdout,terminal:true});readline._writeToOutput=()=>{};
  readline.once('line',async password=>{readline.close();process.stdout.write('\n');if(password.length<8||password.length>128)throw new Error('8~128자 비밀번호가 필요합니다.');console.log(await provisionCredential(password,pepper,kind));});
}
