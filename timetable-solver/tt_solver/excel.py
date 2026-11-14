import json
import openpyxl
from collections import defaultdict
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from .calendar import PBD, RT, DAYS


def write_excel(model, result, path):
    MODEL = model
    SEC_PLACE, BAN_PLACE, UNPLACED = (result.get(k, []) for k in ('SEC_PLACE','BAN_PLACE','UNPLACED'))
    PAIR_ALLOW = result['options']['pairAllowList']
    GANGSA_DAYS = result['options']['gangsaDayCount']
    phase2_ok = result.get('adoptedStage') in ('2','2.5')
    best_max = max(result.get('scores', {}).values(), default=0)
    total_pen_val = sum(result.get('scores', {}).values()) if result.get('adoptedStage') == '2.5' else None
    wb = openpyxl.Workbook()
    thin=Side(style='thin',color='CCCCCC'); bd=Border(left=thin,right=thin,top=thin,bottom=thin)
    hdr=PatternFill('solid',fgColor='305496'); hf=Font(color='FFFFFF',bold=True); ctr=Alignment(horizontal='center',wrap_text=True)
    GREEN=PatternFill('solid',fgColor='D6F0E0'); YELLOW=PatternFill('solid',fgColor='FCEFCB'); GRAY=PatternFill('solid',fgColor='EFEFEF')
    
    # 실시간(rt) 라벨: 교시→실시간은 학년마다 다름. 표시는 실시간 슬롯(1~8, 5는 없음)으로.
    # rt: 1,2,3,4,5,6,7,8 (rt4=1·2학년 4교시 / rt5=3학년 4교시 → 별도 행으로 안 겹침)
    RT_SLOTS=[1,2,3,4,5,6,7,8]
    def rt_label(rt):
        return {1:'1교시',2:'2교시',3:'3교시',4:'4교시(1·2학년)',5:'4교시(3학년)',6:'5교시',7:'6교시',8:'7교시'}[rt]
    
    # ── 시트1: 교사별 시간표 (실시간 기준 → 4교시 겹침 없음) ──
    ws=wb.active; ws.title="교사별 시간표"
    by_t=defaultdict(dict)   # t -> (d,rt) -> text
    for r in BAN_PLACE: by_t[r['t']][(r['d'],RT[r['g']][r['p']])]=f"{r['cls']} {r['sub']}"
    for r in SEC_PLACE: by_t[r['t']][(r['d'],RT[r['g']][r['p']])]=f"{r['g']}{r['block']} {r['sub']}"
    row=1
    for t in MODEL['teachers']:
        ws.cell(row,1,t).font=Font(bold=True,size=12); row+=1
        ws.cell(row,1,"시간").fill=hdr; ws.cell(row,1).font=hf
        for di,dn in enumerate(DAYS):
            c=ws.cell(row,2+di,dn); c.fill=hdr; c.font=hf; c.alignment=ctr
        row+=1
        for rt in RT_SLOTS:
            ws.cell(row,1,rt_label(rt)).font=Font(bold=True)
            for di in range(5):
                c=ws.cell(row,2+di,by_t[t].get((di,rt),"")); c.border=bd; c.alignment=ctr
            row+=1
        row+=1
    for col,wd in [('A',14),('B',18),('C',18),('D',18),('E',18),('F',18)]: ws.column_dimensions[col].width=wd
    
    # ── 시트2: 이동수업 배치표 (요일×교시 격자, 2학년/3학년 블록) ──
    ws2=wb.create_sheet("이동수업 배치표")
    ws2["A1"]="2·3학년 이동수업 블록 배치표 — 한 칸에 2학년·3학년 블록이 함께 열릴 수 있음 (하위분반 3C1/3C2 등은 기본 블록 3C로 표시)"
    ws2["A1"].font=Font(bold=True); ws2.merge_cells("A1:F1")
    # 격자: (요일,교시) → {2:블록, 3:블록}. 교시는 표시용(1~7). 블록 baseCode만, 중복 제거.
    grid=defaultdict(lambda:{'1':set(),'2':set(),'3':set()})
    for r in result["blockSlots"]:
        grid[(r['d'],r['p'])][r['g']].add(r['block'])
    hr=3
    ws2.cell(hr,1,"교시").fill=hdr; ws2.cell(hr,1).font=hf; ws2.cell(hr,1).alignment=ctr
    for di,dn in enumerate(DAYS):
        c=ws2.cell(hr,2+di,dn); c.fill=hdr; c.font=hf; c.alignment=ctr
    r0=hr+1
    for p in range(1,8):
        ws2.cell(r0,1,f"{p}").font=Font(bold=True); ws2.cell(r0,1).alignment=ctr
        for di in range(5):
            cell=ws2.cell(r0,2+di); cell.border=bd; cell.alignment=ctr
            if p not in PBD[di]:
                cell.fill=GRAY; cell.value=""
            else:
                g=grid.get((di,p),{'2':set(),'3':set()})
                g2=" ".join(sorted(g['2'])); g3=" ".join(sorted(g['3']))
                txt=[" ".join(sorted(g.get("1", set())))] if g.get("1") else []
                if g2: txt.append(g2)
                if g3: txt.append(g3)
                cell.value="\n".join(txt)
                if g2 and not g3: cell.fill=GREEN
                elif g3 and not g2: cell.fill=YELLOW
                elif g2 and g3: cell.fill=GREEN  # 둘 다면 초록 바탕(3학년은 텍스트로 구분)
        r0+=1
    ws2.column_dimensions['A'].width=6
    for c in 'BCDEF': ws2.column_dimensions[c].width=18
    for rr in range(hr+1,r0): ws2.row_dimensions[rr].height=34
    
    # ── 시트3: 이동수업 분반 상세 (분반·과목·교사) ──
    ws3=wb.create_sheet("이동수업 분반 상세")
    ws3.append(["학년","블록","요일","교시","분반","과목","담당교사"])
    for c in range(1,8): ws3.cell(1,c).fill=hdr; ws3.cell(1,c).font=hf; ws3.cell(1,c).alignment=ctr
    for r in sorted(SEC_PLACE, key=lambda r:(r['g'],r['block'],r['d'],r['p'],r['div'],r['sub'])):
        ws3.append([f"{r['g']}학년", r['block'], DAYS[r['d']], f"{r['p']}교시", r['div'], r['sub'], r['t']])
    for c,wd in zip('ABCDEFG',[8,8,6,8,10,22,12]): ws3.column_dimensions[c].width=wd
    ws3.freeze_panes="A2"
    
    # ── 시트4: 검증 요약 ──
    ws4=wb.create_sheet("검증 요약")
    ws4.append(["항목","값"])
    ws4.append(["미배치 수", len(UNPLACED)])
    ws4.append(["최고 교사 불편 점수", best_max if phase2_ok else "미산출(1단계 해 사용)"])
    ws4.append(["총 불편 점수", total_pen_val if total_pen_val is not None else "(2.5단계 생략)"])
    ws4.append(["하루2회 분리 허용 과목", ", ".join(PAIR_ALLOW) if PAIR_ALLOW else "없음(모두 하루1회)"])
    ws4.append(["강사 출근일수", str(GANGSA_DAYS)])
    if UNPLACED:
        ws4.append([]); ws4.append(["미배치 목록",""])
        for u in UNPLACED: ws4.append([f"{u['g']}학년 {u['cls']}반", f"{u['sub']} / {u['t']}"])
    ws4.column_dimensions['A'].width=24; ws4.column_dimensions['B'].width=32
    
    
    ws4.append(['결과 상태', result['status']])
    ws4.append(['독립 검사기', result.get('checker', {}).get('status', '미실행')])
    for error in result.get('checker', {}).get('errors', []):
        ws4.append(['검증 실패', error])
    for stage in result.get('stages', []):
        ws4.append(['단계 ' + stage['stage'], json.dumps(stage, ensure_ascii=False)])
    ws4.append(['모델 SHA-256', result.get('modelHash', '')])
    ws4.append(['옵션', json.dumps(result['options'], ensure_ascii=False)])
    # Uploaded labels are text, including names beginning with '='.
    for sheet in wb:
        for cells in sheet:
            for cell in cells:
                if isinstance(cell.value, str):
                    cell.data_type = 's'
    wb.save(path)
