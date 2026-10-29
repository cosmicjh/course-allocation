const encoder=new TextEncoder();
export const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export const newSalt=()=>hex(crypto.getRandomValues(new Uint8Array(16)));
export async function stretchPassword(password,{salt,iterations=100000}){
  if(typeof password!=='string'||password.length>128||!/^[a-f0-9]{32}$/.test(salt)||iterations!==100000)throw new Error('비밀번호 계산 설정이 올바르지 않습니다.');
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations},key,256));
}
export async function preparePasswordRequest(path,data,getParameters){
  if(!data||data.proofVersion===1)return data;
  if(path==='/access/login'||path==='/auth/login'){
    const parameters=await getParameters(path==='/access/login'?'/access/parameters':'/auth/parameters');
    const key=path==='/access/login'?'code':'password';
    return {...data,[key]:await stretchPassword(data[key],parameters),credentialEpoch:parameters.epoch,proofVersion:1};
  }
  if(path==='/access/password'||path==='/auth/password'){
    if(typeof data.password!=='string'||data.password.length<8||data.password.length>128)throw new Error('비밀번호는 8자 이상 128자 이하로 입력하세요.');
    const parameters=await getParameters('/auth/parameters'),salt=newSalt();
    return {current:await stretchPassword(data.current,parameters),currentEpoch:parameters.epoch,
      passwordProof:await stretchPassword(data.password,{salt}),passwordSalt:salt,passwordLength:data.password.length,proofVersion:1};
  }
  return data;
}
