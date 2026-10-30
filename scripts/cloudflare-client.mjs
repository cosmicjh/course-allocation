import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';

export const directory='.cache/cloudflare-test';
export const manifestPath=directory+'/deployment.local.json';
export const credentialsPath=directory+'/credentials.local.json';
export async function manifest(){return JSON.parse(await readFile(manifestPath,'utf8'));}
export async function saveManifest(value){await mkdir(directory,{recursive:true});await writeFile(manifestPath,JSON.stringify(value,null,2)+'\n');}
export async function credentials(){return JSON.parse(await readFile(credentialsPath,'utf8'));}
export function git(...args){
  const executable=process.platform==='win32'?join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe'):'git';
  return execFileSync(executable,['-c','safe.directory='+process.cwd().replaceAll('\\','/'),...args],{encoding:'utf8'}).trim();
}
export async function token(){
  if(process.env.CLOUDFLARE_API_TOKEN)return process.env.CLOUDFLARE_API_TOKEN;
  const path=process.platform==='win32'?join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'):join(homedir(),'.config/.wrangler/config/default.toml');
  const text=await readFile(path,'utf8'),value=text.match(/^oauth_token\s*=\s*"([^"\r\n]+)"/m)?.[1];
  if(!value)throw new Error('Wrangler OAuth 로그인이 필요합니다.');return value;
}
export async function cloudflare(path,{method='GET',body,allow404=false}={}){
  const response=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(response.status===404&&allow404)return null;
  if(!response.ok||result.success===false)throw Object.assign(new Error('Cloudflare '+response.status+': '+JSON.stringify(result.errors??result.error??'request failed')),{status:response.status});
  return result.result??result;
}
export async function graph(query,variables={}){return cloudflare('/graphql',{method:'POST',body:{query,variables}});}
export function assertTestTarget(m){
  if(git('branch','--show-current')!=='cloudflare-test')throw new Error('시험 브랜치에서만 실행할 수 있습니다.');
  if(git('rev-parse','main')!==m.mainRevision)throw new Error('main 기준이 변경되었습니다.');
  if(m.projectName!=='course-allocation-test'||m.databaseId!=='216a677e-9ae1-461d-b451-da63aa27f54a'||m.accountId!=='965071bae1ca798003675034b0ce7ce5')throw new Error('허용된 시험 배포 대상과 일치하지 않습니다.');
}
export async function sql(m,query,params=[]){assertTestTarget(m);return cloudflare(`/accounts/${m.accountId}/d1/database/${m.databaseId}/query`,{method:'POST',body:{sql:query,params}});}
