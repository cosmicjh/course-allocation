'use strict';
const $ = id => document.getElementById(id);
const listKeys = ['buja','gangsa','pairAllowList'];
const jsonKeys = ['gangsaDayCount','blockTimeBan','dependents'];
const weightKeys = ['over4','run3','lunch','firstlast'];
const fields = [...listKeys,...jsonKeys,...weightKeys,'startLimit','limit1','limit2','limit3'];
const defaults = {weights:{over4:1,run3:1,lunch:1,firstlast:1},pairAllowList:[],gangsaDayCount:{},blockTimeBan:{},dependents:[{subject:'스포츠과학',follows:['음악감상과비평(2학년)','미술감상과비평(2학년)']},{subject:'공강(3학년)',follows:['운동과건강(3학년)']}]};
let model = null, selected = null, busy = false, submitting = false, loadNumber = 0;
let warmStart = null, warmLoading = false, warmLoadNumber = 0, availableRuns = [];
const revisions = Object.fromEntries(fields.map(k => [k,0]));
function message(text) { $('message').textContent = text; }
function persist() {
  try { localStorage.setItem('tt-options', JSON.stringify(Object.fromEntries(fields.map(k=>[k,$(k).value])))); } catch { /* The form still works when storage is unavailable. */ }
}
function apply(options, baseline = null) {
  const values = {};
  for (const k of listKeys) if (k in options) values[k] = options[k].join('\n');
  for (const k of jsonKeys) if (k in options) values[k] = JSON.stringify(options[k],null,2);
  for (const k of weightKeys) if (k in (options.weights || {})) values[k] = options.weights[k];
  if (options.limits) options.limits.forEach((n,i)=>values['limit'+(i+1)] = n);
  if (options.startLimit !== undefined) values.startLimit = options.startLimit;
  for (const [k,v] of Object.entries(values)) if (!baseline || baseline[k] === revisions[k]) $(k).value = v;
  persist();
}
let savedDraft = null;
try { savedDraft = JSON.parse(localStorage.getItem('tt-options')); } catch { /* Optional browser storage. */ }
apply(defaults);
if (savedDraft && typeof savedDraft === 'object') for (const k of fields) {
  if (typeof savedDraft[k] === 'string') { $(k).value = savedDraft[k]; revisions[k]++; }
}
persist();
// Restore synchronously before fetching records; late network responses never touch inputs.
// Keep a draft in session memory as well as browser storage through model/settings reads.
function options() {
  const result = {};
  for (const k of listKeys) result[k] = $(k).value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  for (const k of jsonKeys) {
    try { result[k] = JSON.parse($(k).value); } catch { throw Error(`${$(k).parentElement.firstChild.textContent.trim()}: JSON 형식을 확인하세요.`); }
  }
  result.weights = Object.fromEntries(weightKeys.map(k=>[k,Number($(k).value)]));
  result.startLimit = Number($('startLimit').value);
  return result;
}
for (const k of fields) $(k).addEventListener('input',()=>{ revisions[k]++; persist(); });
$('model').addEventListener('change', async event => {
  const file = event.target.files[0], number = ++loadNumber, baseline = {...revisions};
  model = null; updateButton();
  if (!file) return;
  $('model-summary').textContent = '모델을 읽는 중입니다.';
  try {
    const data = JSON.parse(await file.text());
    if (number !== loadNumber) return;
    if (data._type !== '시간표_솔버모델' || data._version !== 1 || !Array.isArray(data.teachers) || !Array.isArray(data.blocks) || !Array.isArray(data.bans)) throw Error('시간표_솔버모델 버전 1 파일을 선택하세요.');
    model = data;
    const modelBaseline = Object.fromEntries(fields.map(k=>[k,baseline[k] === 0 ? 0 : -1]));
    apply({...defaults,...data.options,buja:data.buja || [],gangsa:data.gangsa || []}, modelBaseline);
    $('model-summary').textContent = `${file.name} · 교사 ${data.teachers.length}명 · 이동수업 ${data.blocks.length}행 · 반수업 ${data.bans.length}행`;
    message('모델을 불러왔습니다. 옵션을 확인하세요.');
  } catch (error) { if (number === loadNumber) { model = null; $('model-summary').textContent = '모델을 읽지 못했습니다.'; message(error.message); } }
  updateButton();
});
$('settings').addEventListener('change', async event => {
  const file = event.target.files[0], baseline = {...revisions};
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data._type !== '고교학점제_설정' || data._version !== 1 || !data.timetable) throw Error('고교학점제_설정 버전 1 JSON을 선택하세요.');
    const s = data.timetable;
    const converted = {...s, ...(s.pairAllow ? {pairAllowList:s.pairAllow} : {}), ...(s.bujaList ? {buja:s.bujaList} : {})};
    if (s.weights) converted.weights = Object.fromEntries(Object.entries(s.weights).map(([k,v])=>[k,Number(v)]));
    if (s.gangsaDayCount) converted.gangsaDayCount = Object.fromEntries(Object.entries(s.gangsaDayCount).filter(([,n])=>Number(n)>0).map(([t,n])=>[t,Number(n)]));
    apply(converted, baseline);
    for (const k of fields) revisions[k]++; // A later model load cannot overwrite imported settings.
    message('이전 설정을 불러왔습니다. 미연결 설정은 적용 여부 표를 확인하세요.');
  } catch (error) { message(error.message); }
});
function updateButton() { $('run').disabled = !model || busy || submitting || warmLoading; }
function clearWarmStart() {
  warmLoadNumber++; warmLoading = false; warmStart = null;
  $('warm-run').value = ''; $('warm-file').value = '';
  $('warm-summary').textContent = '이전 결과가 없으면 1단계 시간을 늘려야 할 수 있습니다.';
  updateButton();
}
$('warm-clear').addEventListener('click', clearWarmStart);
$('warm-run').addEventListener('change', () => {
  warmLoadNumber++; warmLoading = false; $('warm-file').value = '';
  warmStart = availableRuns.find(r=>r.id === $('warm-run').value)?.result || null;
  $('warm-summary').textContent = warmStart ? '이전 실행을 1단계 힌트로 사용합니다. 0단계는 생략합니다.' : '이전 결과가 없으면 1단계 시간을 늘려야 할 수 있습니다.';
  updateButton();
});
$('warm-file').addEventListener('change', async event => {
  const file = event.target.files[0], number = ++warmLoadNumber;
  warmStart = null; $('warm-run').value = '';
  if (!file) { clearWarmStart(); return; }
  warmLoading = true; updateButton(); $('warm-summary').textContent = '시작점 파일을 읽는 중입니다.';
  try {
    const data = JSON.parse(await file.text());
    if (number !== warmLoadNumber) return;
    if (!data || !['SEC_PLACE','BAN_PLACE'].some(k=>Array.isArray(data[k])) || ['SEC_PLACE','BAN_PLACE','blockSlots'].some(k=>data[k] !== undefined && !Array.isArray(data[k]))) throw Error('배치 행이 포함된 result.json을 선택하세요.');
    warmStart = data;
    $('warm-summary').textContent = `${file.name} · rowId로 대응해 1단계 힌트로 사용하며 0단계는 생략합니다.`;
  } catch (error) { if (number === warmLoadNumber) $('warm-summary').textContent = error.message; }
  finally { if (number === warmLoadNumber) { warmLoading = false; updateButton(); } }
});
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}
$('form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    submitting = true; updateButton();
    const run = await api('/api/runs', {model,options:options(),limits:[1,2,3].map(i=>Number($('limit'+i).value)),warmStart});
    selected = run.id;
    message('계산을 시작했습니다.');
    await refresh();
  } catch (error) { message(error.message); }
  finally { submitting = false; updateButton(); }
});
function node(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
function renderResult(run) {
  const result = run.result;
  $('result-section').hidden = !result;
  if (!result) return;
  const target = $('result'); target.replaceChildren();
  target.append(node('p',`${result.status} · 채택 단계 ${result.adoptedStage || '없음'} · 미배치 ${result.UNPLACED?.length ?? '—'}건`));
  if (result.checker) target.append(node('p',result.checker.status,'error'));
  if (result.warmStart?.source === 'previous_result') {
    const s = result.warmStart;
    target.append(node('p',`시작점 rowId 대응 ${s.matchedRowIds}/${s.rowIds} (${(s.matchRate*100).toFixed(1)}%) · 미대응 ${s.ignoredRowIds}개 무시`));
  }
  for (const error of [...(result.errors || []),...(result.checker?.errors || [])]) target.append(node('p',error,'error'));
  if (result.BAN_PLACE) { const a = node('a','엑셀 4개 시트 다운로드'); a.href = `/api/runs/${run.id}/result.xlsx`; a.download = '시간표결과.xlsx'; target.append(a); }
  const stages = node('table'); const cap = node('caption','단계별 탐색 결과'); stages.append(cap);
  const head = node('tr'); for(const text of ['단계','상태','목적값','소요 시간','채택']) head.append(node('th',text)); stages.append(head);
  for (const s of result.stages || []) { const tr = node('tr'); for(const text of [s.relaxed ? `${s.stage} · 완화 시작점` : s.stage,s.status,s.objective ?? '—',`${s.wall_time.toFixed(2)}초`,s.adopted?'채택':s.relaxed?'시작점 전용':'']) tr.append(node('td',text)); stages.append(tr); }
  const stageWrap = node('div',null,'table-wrap'); stageWrap.append(stages); target.append(stageWrap);
  if (result.BAN_PLACE) {
    const counts = new Map();
    for (const r of [...result.BAN_PLACE,...result.SEC_PLACE]) { const entry = counts.get(r.t) || {hours:0,days:new Set()}; entry.hours++; entry.days.add(r.d); counts.set(r.t,entry); }
    const table = node('table'); table.append(node('caption','교사별 배치 요약'));
    const tr = node('tr'); for(const h of ['교사','배치 시수','출근일수','불편 점수']) tr.append(node('th',h)); table.append(tr);
    for(const [t,c] of counts) { const row = node('tr'); for(const v of [t,c.hours,c.days.size,result.scores[t] ?? '강사 제외']) row.append(node('td',v)); table.append(row); }
    const wrap = node('div',null,'table-wrap'); wrap.append(table); target.append(wrap);
  }
}
let refreshing = false;
let lastRecords = '';
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const records = await api('/api/runs');
    availableRuns = records;
    const eligible = records.filter(r=>r.result && (Array.isArray(r.result.SEC_PLACE) || Array.isArray(r.result.BAN_PLACE)));
    const choice = $('warm-run').value;
    if (JSON.stringify(eligible.map(r=>r.id)) !== JSON.stringify(Array.from($('warm-run').options).slice(1).map(o=>o.value))) {
      $('warm-run').replaceChildren(new Option('사용하지 않음',''), ...eligible.map(r=>new Option(`${r.id} · ${r.state}`,r.id)));
      $('warm-run').value = choice;
    }
    busy = records.some(r=>r.state === '실행 중'); updateButton();
    const signature = JSON.stringify([selected, records]);
    if (signature === lastRecords) return;
    lastRecords = signature;
    $('runs').replaceChildren();
    if (!records.length) $('runs').append(node('p','아직 실행 기록이 없습니다.'));
    if (!selected && records.length) selected = records[0].id;
    for(const r of records) {
      const row = node('div',null,'run-row'), text = node('div');
      text.append(node('p',r.id,'run-id'),node('p',`${r.state}${r.stage ? ' · '+r.stage+'단계' : ''}`));
      const controls = node('div',null,'controls'), view = node('button','결과 보기','secondary');
      view.type = 'button'; view.addEventListener('click',()=>{selected=r.id;renderResult(r);$('result-section').scrollIntoView();}); controls.append(view);
      if(r.state === '실행 중') { const cancel=node('button','계산 취소','secondary');cancel.type='button';cancel.addEventListener('click',async()=>{try{await api(`/api/runs/${r.id}/cancel`,{});await refresh();}catch(e){message(e.message);}});controls.append(cancel); }
      row.append(text,controls);$('runs').append(row);
      if(r.id === selected) renderResult(r);
    }
  } catch(error) { message('서버에 연결하지 못했습니다. 콘솔 창을 확인한 뒤 새로고침하세요.'); }
  finally { refreshing = false; }
}
$('refresh').addEventListener('click',refresh);
refresh();
setInterval(refresh,2000);
