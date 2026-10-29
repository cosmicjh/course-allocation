const samples=[];
const rounded=value=>Math.round(value*100)/100;
export const metrics={
  request(sample){samples.push({...sample,ms:rounded(sample.ms)});if(samples.length>100)samples.shift();},
  render(ms){samples.push({action:'render',path:'workspace',method:'LOCAL',status:200,ms:rounded(ms),serverTiming:''});if(samples.length>100)samples.shift();},
  snapshot(){
    const navigation=performance.getEntriesByType('navigation')[0];
    return {domContentLoadedMs:rounded(navigation?.domContentLoadedEventEnd||0),samples:samples.map(x=>({...x}))};
  },
  clear(){samples.length=0;}
};
if(typeof window!=='undefined')window.ALLOCATION_PERFORMANCE=metrics;
export function showPerformance(){
  const dialog=document.querySelector('#dialog'),data=metrics.snapshot();
  dialog.className='wide';dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">성능 측정</h2><button type="button" data-perf="close">닫기</button></div><div class="dialog-body"><p>현재 탭의 최근 100개 측정값입니다. API 시간은 네트워크 왕복을 포함하고 DB 시간은 서버에서 측정합니다. 입력 내용·비밀번호·토큰은 기록하지 않습니다.</p><div class="table-scroll"><table><thead><tr><th>작업</th><th>경로</th><th>상태</th><th>클라이언트(ms)</th><th>서버 시간</th></tr></thead><tbody></tbody></table></div></div><div class="dialog-footer"><button type="button" data-perf="download">측정 JSON 다운로드</button></div>';
  const tbody=dialog.querySelector('tbody');
  for(const sample of data.samples.slice(-20)){const row=document.createElement('tr');for(const value of [sample.action,sample.path,sample.status,sample.ms,sample.serverTiming]){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}tbody.append(row);}
  dialog.querySelector('[data-perf=close]').onclick=()=>dialog.close();
  dialog.querySelector('[data-perf=download]').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(metrics.snapshot(),null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='allocation-performance.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  if(!dialog.open)dialog.showModal();
}
