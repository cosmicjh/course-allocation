import {cloudflare,manifest,assertTestTarget} from './cloudflare-client.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const m=await manifest();assertTestTarget(m);
const path=`/accounts/${m.accountId}/pages/projects/${m.projectName}/deployments/${m.deploymentId}/tails`;
const tail=await cloudflare(path,{method:'POST',body:{filters:[],sampling_rate:1}});
const events=[];let socket,receive;
const duration=Number(process.env.ALLOCATION_TAIL_MS||90000);
if(!Number.isInteger(duration)||duration<10000||duration>120000)throw new Error('로그 관찰 시간은 10~120초입니다.');
await mkdir('test-results/cloudflare',{recursive:true});
try{
  socket=new WebSocket(tail.url,'trace-v1');
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('실행 로그 연결 시간 초과')),15000);socket.addEventListener('open',()=>{clearTimeout(timer);socket.send(JSON.stringify({debug:true}));resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('실행 로그 연결 실패'));},{once:true});});
  socket.addEventListener('message',receive=async message=>{
    try{
      const text=typeof message.data==='string'?message.data:await message.data.text(),value=JSON.parse(text);
      // Request headers, bodies, console messages and tokens are never retained.
      events.push({eventTimestamp:value.eventTimestamp,outcome:value.outcome,scriptName:value.scriptName,
        cpuTimeMs:value.cpuTimeMs??value.cpuTime??null,cpuTime:value.cpuTime??null,wallTimeMs:value.wallTimeMs??value.wallTime??null,
        method:value.event?.request?.method,path:value.event?.request?.url?new URL(value.event.request.url).pathname:null,fields:Object.keys(value)});
    }catch{}
  });
  await writeFile('test-results/cloudflare/tail-ready.local.json',JSON.stringify({deploymentId:m.deploymentId,readyAt:new Date().toISOString()}));
  console.log('시험 배포 실행 로그 연결 완료. 헤더·본문·토큰은 저장하지 않습니다.');
  await new Promise(resolve=>setTimeout(resolve,duration));
}finally{
  if(receive)socket?.removeEventListener('message',receive);
  socket?.close();await cloudflare(path+'/'+tail.id,{method:'DELETE'}).catch(()=>{});
  await writeFile('test-results/cloudflare/live-tail.json',JSON.stringify({deploymentId:m.deploymentId,events},null,2)+'\n');
}
console.log('시험 실행 로그',events.length,'건 저장');
// A remote WebSocket may leave its close handshake pending in Node's client pool.
// Reports and API cleanup are complete; do not leave a test observer running.
setTimeout(()=>process.exit(0),1000).unref();
