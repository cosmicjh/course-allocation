import {metrics} from './performance.js';
import {preparePasswordRequest} from './password.js';

export function createTransport({onExpired=()=>{}}={}) {
  const config=window.ALLOCATION_CONFIG??{},base=config.apiBase||'/api';
  if(new URL(base,location.href).origin!==location.origin)throw new Error('API는 같은 사이트의 주소를 사용해야 합니다.');
  const key='allocation-access-'+(config.appId||location.host),pending=new Map();
  let accessToken='',adminToken='',loginPending=null;
  try{accessToken=sessionStorage.getItem(key)||'';}catch{}
  function keepAccess(token){accessToken=token;try{if(token)sessionStorage.setItem(key,token);else sessionStorage.removeItem(key);}catch{}}
  async function call(path,method,data,token){
    const start=performance.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    const action=(path==='/workspace'||path==='/state'||path==='/access/login'&&data?.includeState)?'load':method==='PUT'?'save':'auth';
    let status=0,timing='';
    try{
      data=await preparePasswordRequest(path,data,parametersPath=>call(parametersPath,'GET',undefined,token));
      const url=new URL(base.replace(/\/$/,'')+path,location.origin);
      if(method==='GET'&&data)for(const [name,value] of Object.entries(data))url.searchParams.set(name,String(value));
      const response=await fetch(url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(method==='GET'?{}:{'Content-Type':'application/json'})},
        ...(method==='GET'?{}:{body:JSON.stringify(data??{})}),signal:controller.signal,cache:'no-store',credentials:'same-origin'});
      status=response.status;timing=response.headers.get('Server-Timing')||'';
      let result;try{result=await response.json();}catch{throw Object.assign(new Error('서버 응답을 해석하지 못했습니다.'),{status:503,code:'invalid_response'});}
      if(!response.ok||!result.ok)throw Object.assign(new Error(result.message||'요청 실패'),{status:response.status,code:result.code});
      return result.data;
    }catch(error){if(error.name==='AbortError')throw Object.assign(new Error('서버 응답 시간이 초과되었습니다. 입력은 유지됩니다. 다시 저장하세요.'),{status:503,code:'request_timeout'});throw error;}
    finally{clearTimeout(timer);metrics.request({action,path:path.replace(/\/sheets\/[^/]+/,'/sheets/:id'),method,status,ms:performance.now()-start,serverTiming:timing});}
  }
  function login(includeState=false){
    if(loginPending)return loginPending;
    loginPending=new Promise(resolve=>{
      const dialog=document.querySelector('#dialog');if(dialog?.open)dialog.close();
      document.querySelector('#app').innerHTML='<main class="access-screen"><form id="access-form"><h1>교과 시수배당</h1><label class="field">비밀번호<input name="code" type="password" autocomplete="current-password" required maxlength="128"></label><p id="access-error" role="alert"></p><button type="submit" class="primary">접속</button></form></main>';
      const form=document.querySelector('#access-form');
      form.onsubmit=async event=>{
        event.preventDefault();const button=form.querySelector('button');button.disabled=true;document.querySelector('#access-error').textContent='';
        try{const result=await call('/access/login','POST',{code:String(new FormData(form).get('code')),includeState,scoped:true},'');keepAccess(result.accessToken);loginPending=null;resolve(result.workspace??null);}
        catch(error){document.querySelector('#access-error').textContent=error.message;button.disabled=false;}
      };
      form.querySelector('input').focus();
    });
    return loginPending;
  }
  async function request(path,method='GET',data){
    const initial=method==='GET'&&path==='/workspace'&&data===undefined;
    if(!accessToken){const workspace=await login(initial);if(initial&&workspace)return workspace;}
    // Keep the same operation ID until an ambiguous save has a confirmed outcome.
    if(method==='PUT'){
      const {operationId:ignored,...content}=data;
      const fingerprint=JSON.stringify(content),saved=pending.get(path);
      if(!saved||saved.fingerprint!==fingerprint)pending.set(path,{fingerprint,id:'save-'+crypto.randomUUID()});
      data={...content,operationId:pending.get(path).id};
    }
    let result;
    try{
      try{result=await call(path,method,data,adminToken||accessToken);}
      catch(error){
        if(error.code==='access_required'){
          adminToken='';keepAccess('');onExpired();const workspace=await login(initial);if(initial&&workspace)return workspace;
          result=await call(path,method,data,accessToken);
        }else throw error;
      }
      if(result.accessToken)keepAccess(result.accessToken);
      if(result.adminToken)adminToken=result.adminToken;
      if(path==='/auth/logout')adminToken='';
      pending.delete(path);return result;
    }catch(error){
      if(error.code==='admin_required')adminToken='';
      if(error.status>=400&&error.status<500)pending.delete(path);
      throw error;
    }
  }
  return {request};
}
