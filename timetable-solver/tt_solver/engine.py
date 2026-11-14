from collections import defaultdict
from ortools.sat.python import cp_model
from .validation import score_bounds
from . import hints

PBD={0:[2,3,4,5,6,7],1:[1,2,3,4,5,6,7],2:[1,2,3,4],3:[1,2,3,4,5,6,7],4:[1,2,3,4,5,6,7]}
RT={'1':{1:1,2:2,3:3,4:4,5:6,6:7,7:8},'2':{1:1,2:2,3:3,4:4,5:6,6:7,7:8},'3':{1:1,2:2,3:3,4:5,5:6,6:7,7:8}}
DAYS=['월','화','수','목','금']
def cf(): return [(d,p) for d in range(5) for p in PBD[d]]

def build(m, pair_allow, gangsa_days, block_time_ban=None, dependents=None, daily_min=True):
    pa=set(pair_allow or []); gd_lim=gangsa_days or {}
    block_time_ban = block_time_ban or {}   # {블록코드: [(요일,교시), ...]}  해당 블록을 그 칸에 배치 금지
    dependents = dependents or []           # [{subject, follows:[...]}] — 학생 그룹이 같은 과목군
    buja=set(m['buja']); gangsa=set(m['gangsa'])
    cm=cp_model.CpModel()
    blocks=defaultdict(lambda:{'len':0}); sec=[]
    if m['blocks'] and not all(('div' in b) for b in m['blocks']):
        raise ValueError(
            "이 모델 파일에는 분반 세부코드(div)가 없습니다. 이전 버전 웹 도구로 내보낸 파일입니다.\n"
            "→ 최신 웹 도구(시간표검증기_통합.html)에서 교과배당표를 다시 올리고 '⬇ 코랩 솔버용 모델 내보내기'로\n"
            "  새 .json 파일을 받아 셀 ②에 업로드한 뒤 다시 실행해 주세요. (옛 파일로는 정확한 배치가 불가능합니다)")
    for b in m['blocks']:
        k=(b['grade'],b['block']); blocks[k]['len']=b['blockLen']
        sec.append((b['grade'],b['block'],b['div'],b['subject'],b['teacher'],b['hours']))
    slot={}
    for (g,bc),info in blocks.items():
        sv=[]
        for si in range(info['len']):
            v={(d,p):cm.NewBoolVar(f's{g}{bc}{si}_{d}_{p}') for (d,p) in cf()}
            cm.Add(sum(v.values())==1); slot[(g,bc,si)]=v; sv.append(v)
        # 같은 블록의 슬롯들은 서로 다른 요일에 (한 블록=하루 1칸; 같은 반을 하루 두 번 금지)
        for d in range(5):
            day_vars=[sv[si][(d,p)] for si in range(info['len']) for p in PBD[d]]
            if len(day_vars)>1: cm.Add(sum(day_vars)<=1)
        # 블록 배치 금지 칸 (예: 3C·3G를 금요일 6·7교시 금지)
        for (bd,bp) in block_time_ban.get(bc, []):
            for si in range(info['len']):
                if (bd,bp) in slot[(g,bc,si)]:
                    cm.Add(slot[(g,bc,si)][(bd,bp)]==0)
    bycell=defaultdict(list)
    for (g,bc),info in blocks.items():
        for si in range(info['len']):
            for (d,p),var in slot[(g,bc,si)].items(): bycell[(g,d,p)].append(var)
    for k,vs in bycell.items():
        if len(vs)>1: cm.Add(sum(vs)<=1)
    secs_b=defaultdict(list)
    for idx,(g,bc,div,sub,t,h) in enumerate(sec): secs_b[(g,bc)].append((idx,div,sub,t,h))
    y={}; place=defaultdict(list); subj_place=defaultdict(list)
    for (g,bc),info in blocks.items():
        L=info['len']
        for (idx,div,sub,t,h) in secs_b[(g,bc)]:
            ys=[cm.NewBoolVar(f'y{idx}_{si}') for si in range(L)]
            for si in range(L): y[(idx,si)]=ys[si]
            cm.Add(sum(ys)==h)
        byds=defaultdict(list)
        for (idx,div,sub,t,h) in secs_b[(g,bc)]: byds[(div,sub)].append(idx)
        for (div,sub),idxs in byds.items():
            for si in range(L):
                xs=[y[(i,si)] for i in idxs]
                if len(xs)>1: cm.Add(sum(xs)<=1)
        for (idx,div,sub,t,h) in secs_b[(g,bc)]:
            for si in range(L):
                for (d,p),sv in slot[(g,bc,si)].items():
                    pl=cm.NewBoolVar(f'pb{idx}_{si}_{d}_{p}')
                    cm.AddMultiplicationEquality(pl,[y[(idx,si)],sv])
                    place[(t,d,RT[g][p])].append(pl)
                    subj_place[(g,sub,d,p)].append(pl)   # 학년·과목·칸별 배치 지표(종속과목 제약용)
    # ── 종속 과목(dependents): 주과목은 follows 과목군과 같은 시간에 겹치면 안 됨 ──
    #   예: 스포츠과학(주과목)은 음악감상과비평·미술감상과비평(follows) 중 무엇을 듣던 학생이든
    #   나중에 함께 듣는 과목이라, "스포츠과학 시간"과 "음감비 또는 미감비 시간"은 겹치면 안 된다.
    #   (반대로 음감비·미감비끼리는 같은 시간에 있는 게 정상 — 학생이 그 중 하나를 선택하는 병렬 구조)
    for dep in dependents:
        main_sub=dep.get('subject'); follows=list(dep.get('follows') or [])
        if not main_sub or not follows: continue
        all_subs=[main_sub]+follows
        grades_involved=set(g for (g,bc) in blocks for (idx,div,sub,t,h) in secs_b[(g,bc)] if sub in all_subs)
        for g in grades_involved:
            for (d,p) in cf():
                main_vs=subj_place.get((g,main_sub,d,p))
                follow_vs=[v for sub in follows for v in subj_place.get((g,sub,d,p),[])]
                if not main_vs or not follow_vs: continue
                main_ind=cm.NewBoolVar(f'depM_{g}_{main_sub}_{d}_{p}'); cm.AddMaxEquality(main_ind,main_vs)
                follow_ind=cm.NewBoolVar(f'depF_{g}_{main_sub}_{d}_{p}'); cm.AddMaxEquality(follow_ind,follow_vs)
                cm.Add(main_ind+follow_ind<=1)
    ban_unit={}
    for i,l in enumerate(m['bans']):
        g=l['grade']; units=[]
        for h in range(l['hours']):
            v={(d,p):cm.NewBoolVar(f'u{i}_{h}_{d}_{p}') for (d,p) in cf()}
            placed=cm.NewBoolVar(f'pp{i}_{h}')
            cm.Add(sum(v.values())==placed); units.append({'cells':v,'placed':placed})
        ban_unit[i]={'units':units,'g':g,'cls':l['cls'],'sub':l['subject'],'t':l['teacher'],'art':bool(l.get('art'))}
    occ=defaultdict(list)
    for k,vs in place.items(): occ[k].extend(vs)
    for i,bu in ban_unit.items():
        for u in bu['units']:
            for (d,p),var in u['cells'].items(): occ[(bu['t'],d,RT[bu['g']][p])].append(var)
    for k,vs in occ.items():
        if len(vs)>1: cm.Add(sum(vs)<=1)
    # ── 학급 빈칸 없음(전 학년 반별고정): 각 (학년,반,요일,교시) 칸은 정확히 1개 활동 ──
    #    (반수업 1과목 또는 그 학년 블록 1개). 빈칸·중복 금지. 한 반의 반수업+블록 = 31.
    cls_units=defaultdict(list)
    for i,bu in ban_unit.items():
        for u in bu['units']: cls_units[(bu['g'],bu['cls'])].append(u)
    block_at=defaultdict(list)
    for (g,bc),info in blocks.items():
        for si in range(info['len']):
            for (d,p),var in slot[(g,bc,si)].items(): block_at[(g,d,p)].append(var)
    for (g,cls),units in cls_units.items():
        for (d,p) in cf():
            ban_here=[u['cells'][(d,p)] for u in units if (d,p) in u['cells']]
            blk_here=block_at.get((g,d,p),[])
            terms=ban_here+blk_here
            if terms: cm.Add(sum(terms)==1)
    # 부장 금요일 1교시 금지 — 반수업에만 적용(블록 제외). 단 진로는 금1 고정 대상이라 제외.
    for i,bu in ban_unit.items():
        if bu['t'] in buja and '진로' not in bu['sub']:
            for u in bu['units']:
                if (4,1) in u['cells']: cm.Add(u['cells'][(4,1)]==0)
    # 3학년 진로를 금요일(d=4) 1교시(p=1)에 고정 → 3학년 블록이 금요일 1교시를 비워 학급 빈칸 없음과 양립
    for i,bu in ban_unit.items():
        if bu['g']=='3' and '진로' in bu['sub']:
            for u in bu['units']:
                if (4,1) in u['cells']: cm.Add(u['cells'][(4,1)]==1)
    grp=defaultdict(list)
    art_grp=defaultdict(list)   # 미술(연강) 그룹은 별도 처리
    for i,bu in ban_unit.items():
        key=(bu['g'],bu['cls'],bu['sub'],bu['t'])
        if bu.get('art'): art_grp[key].append(i)
        else: grp[key].append(i)
    for gkey,idxs in grp.items():
        g,cls,sub,t=gkey; allow=sub in pa
        if t in gangsa: continue   # 강사는 조건2(같은과목 하루1회) 면제
        for d in range(5):
            dv=[]
            for i in idxs:
                for u in ban_unit[i]['units']:
                    for p in PBD[d]: dv.append((p,u['cells'][(d,p)]))
            if not allow: cm.Add(sum(v for _,v in dv)<=1)
            else:
                cm.Add(sum(v for _,v in dv)<=2)
                for a in range(len(dv)):
                    for b2 in range(a+1,len(dv)):
                        if abs(dv[a][0]-dv[b2][0])<3: cm.Add(dv[a][1]+dv[b2][1]<=1)
    # ── 미술 연강: 같은 학급 미술 3시간 = 2시간 연속(같은 날 인접 2교시) + 1시간 따로(다른 날) ──
    # 연강 인접쌍(교시 기준, 점심 안 끼움): 위에서 계산한 패턴
    def art_pairs(d):
        ps=PBD[d]
        return [(ps[k],ps[k+1]) for k in range(len(ps)-1) if ps[k+1]-ps[k]==1 and not (ps[k]==4 and ps[k+1]==5)]
    for gkey,idxs in art_grp.items():
        g,cls,sub,t=gkey
        # 이 학급 미술의 모든 시간 유닛(보통 3개) 셀 변수
        units=[u for i in idxs for u in ban_unit[i]['units']]
        # (1) 하루 최대 2시간 (3시간을 한 날에 몰지 않음)
        for d in range(5):
            day_cells=[u['cells'][(d,p)] for u in units for p in PBD[d]]
            cm.Add(sum(day_cells)<=2)
        # (2) 연강쌍 변수: 각 (요일,인접교시쌍)에 '미술 2칸 연속' 여부. 정확히 1개 존재.
        pair_vars=[]
        for d in range(5):
            for (p1,p2) in art_pairs(d):
                c1=[u['cells'][(d,p1)] for u in units]; c2=[u['cells'][(d,p2)] for u in units]
                # 이 쌍에 미술이 두 칸(p1,p2) 모두 있는가
                a1=cm.NewBoolVar(f'art_{g}{cls}_{d}_{p1}a'); cm.AddMaxEquality(a1,c1)
                a2=cm.NewBoolVar(f'art_{g}{cls}_{d}_{p1}b'); cm.AddMaxEquality(a2,c2)
                pr=cm.NewBoolVar(f'artpair_{g}{cls}_{d}_{p1}')
                cm.AddBoolAnd([a1,a2]).OnlyEnforceIf(pr)
                cm.AddBoolOr([a1.Not(),a2.Not()]).OnlyEnforceIf(pr.Not())
                pair_vars.append((d,p1,p2,pr))
        # 정확히 한 곳에서 연강(2연강) 발생
        cm.Add(sum(pr for _,_,_,pr in pair_vars)==1)
        # (3) 연강이 일어난 날에는 미술이 정확히 2시간(그 쌍), 다른 어떤 날에 1시간(단독)
        #     → 각 날의 미술 시간 수: 연강날=2, 단독날=1, 그 외=0. 이미 하루<=2 이므로
        #       "연강 발생 날 = 2시간" 과 "단독은 다른 날"을 보장하기 위해:
        #       연강쌍 pr=1인 날 d*에서, 그 날 미술 합==2 (단독이 같은 날 끼지 않게)
        for (d,p1,p2,pr) in pair_vars:
            day_cells=[u['cells'][(d,p)] for u in units for p in PBD[d]]
            cm.Add(sum(day_cells)==2).OnlyEnforceIf(pr)   # 연강 날은 딱 2시간
    for t,N in gd_lim.items():
        if t not in gangsa: continue
        dus=[]
        for d in range(5):
            du=cm.NewBoolVar(f'gd{t}{d}'); tv=[]
            for i,bu in ban_unit.items():
                if bu['t']==t:
                    for u in bu['units']:
                        for p in PBD[d]: tv.append(u['cells'][(d,p)])
            for kk,vs in place.items():
                if kk[0]==t and kk[1]==d: tv.extend(vs)
            if tv:
                for v in tv: cm.Add(du>=v)
                cm.Add(du<=sum(tv))
            dus.append(du)
        cm.Add(sum(dus)<=int(N))

    # ===== 추가 하드 제약 (교사별 점유 occ_t[(t,d,rt)] 구성) =====
    # 블록 점유: place[(t,d,rt)] (이미 실시간 키). 반수업: 각 유닛의 (d,p)→rt.
    occ_raw=defaultdict(list)
    for kk,vs in place.items(): occ_raw[kk].extend(vs)   # (t,d,rt)
    for i,bu in ban_unit.items():
        g=bu['g']; t=bu['t']
        for u in bu['units']:
            for (d,p),var in u['cells'].items(): occ_raw[(t,d,RT[g][p])].append(var)
    # occ_t[(t,d,rt)] = 그 시간에 수업하는가 (불리언)
    occ_t={}
    for (t,d,rt),vs in occ_raw.items():
        if not vs: continue
        b=cm.NewBoolVar(f'oc_{t}_{d}_{rt}'); cm.AddMaxEquality(b,vs); occ_t[(t,d,rt)]=b
    # 점심 보장: 같은 날 4교시(1·2학년=rt4)와 4교시(3학년=rt5)를 동시에 맡으면 식사 불가 → 금지 (강사 제외)
    for t in m['teachers']:
        if t in gangsa: continue
        for d in range(5):
            a=occ_t.get((t,d,4)); b=occ_t.get((t,d,5))
            if a is not None and b is not None:
                cm.Add(a + b <= 1)
    TT=m.get('teacherTotal',{})
    RT_BY_DAY={0:[2,3,4,5,6,7,8],1:[1,2,3,4,5,6,7,8],2:[1,2,3,4,5],3:[1,2,3,4,5,6,7,8],4:[1,2,3,4,5,6,7,8]}
    # 학년 무관 실시간 슬롯(표시 4교시 분리 rt4/rt5 포함). 1교시=rt1, 7교시=rt8.
    for t in m['teachers']:
        if t in gangsa: continue   # 강사는 출근일수만 적용, 나머지 제약 전부 면제
        light = TT.get(t,16) < 16   # (현재 1교시·7교시는 전원 1일로 완화되어 미사용)
        # 제약1: 1교시(rt1) — 화수목금(d=1,2,3,4) 중 무조건 2~3일 보유 (비는 날 1~2일)
        free1=[]
        for d in [1,2,3,4]:
            has1=occ_t.get((t,d,1))
            f=cm.NewBoolVar(f'f1_{t}_{d}')
            if has1 is None: cm.Add(f==1)
            else:
                cm.Add(f + has1 == 1)   # f=1 ⟺ 1교시 비어있음
            free1.append(f)
        cm.Add(sum(free1) >= 1); cm.Add(sum(free1) <= 2)   # 1교시 갖는 날 2~3
        # 제약2: 7교시(rt8) — 월화목금(d=0,1,3,4) 중 무조건 2~3일 보유 (비는 날 1~2일)
        free7=[]
        for d in [0,1,3,4]:
            has7=occ_t.get((t,d,8))
            f=cm.NewBoolVar(f'f7_{t}_{d}')
            if has7 is None: cm.Add(f==1)
            else:
                cm.Add(f + has7 == 1)
            free7.append(f)
        cm.Add(sum(free7) >= 1); cm.Add(sum(free7) <= 2)   # 7교시 갖는 날 2~3
        # 제약3: 하루 최대 시수 — 월4·화5·수3·목5·금5
        DAILY_MAX={0:4,1:5,2:3,3:5,4:5}
        for d in range(5):
            daily=[occ_t[(t,d,rt)] for rt in RT_BY_DAY[d] if (t,d,rt) in occ_t]
            if daily:
                cm.Add(sum(daily) <= DAILY_MAX[d])
        # 제약3-b: 강사 제외 교사는 매일 수업(주5일), 그리고 매일 2시간 이상 (월2~4 화2~5 수2~3 목2~5 금2~5)
        if t not in gangsa and daily_min:
            for d in range(5):
                daily=[occ_t[(t,d,rt)] for rt in RT_BY_DAY[d] if (t,d,rt) in occ_t]
                if daily:
                    cm.Add(sum(daily) >= 2)   # 매일 2시간 이상 (0시간=쉬는 날 금지)
        # 제약4: 최대 3연강 (점심 끼임도 연강으로 봄). 실시간 인접관계(점심 가로지르는 4→6, 3→5 포함):
        #   레일: 1-2-3-4-6-7-8 (1·2학년: 4교시 직후 점심 뒤 5교시=rt6), 그리고 3-5 (3학년: 3교시 뒤 점심 뒤 4교시=rt5), 5-6
        # 한 교사가 그날 점유한 실시간들이 이 레일 상에서 4개 연속이면 금지.
        # 레일을 순서열로 표현(인접쌍이 연강): [1,2,3,4,6,7,8] 와 3학년분기 [.,.,3,5,6,..]
        # 구현: 인접쌍 집합으로 연속열 생성
        ADJ_PAIRS={(1,2),(2,3),(3,4),(3,5),(4,6),(5,6),(6,7),(7,8)}
        # 가능한 모든 '4개 연속 사슬'을 미리 열거
        def chains_of(length):
            res=[]; allrt=[1,2,3,4,5,6,7,8]
            def ext(path):
                if len(path)==length: res.append(tuple(path)); return
                last=path[-1]
                for nxt in allrt:
                    if nxt>last and ((last,nxt) in ADJ_PAIRS): ext(path+[nxt])
            for st0 in allrt: ext([st0])
            return res
        for d in range(5):
            for ch in chains_of(4):
                vs=[occ_t[(t,d,rt)] for rt in ch if (t,d,rt) in occ_t]
                if len(vs)==4: cm.Add(sum(vs)<=3)

    total=sum(len(bu['units']) for bu in ban_unit.values())
    placed=sum(u['placed'] for bu in ban_unit.values() for u in bu['units'])
    return cm, slot, blocks, secs_b, y, ban_unit, place, total, placed

def teacher_occupancy(cm, slot, blocks, secs_b, y, ban_unit, place, teachers):
    # 실시간(rt) 기준 점유: occ[(t,d,rt)]
    raw=defaultdict(list)
    for kk,vs in place.items(): raw[kk].extend(vs)   # place는 (t,d,rt) 키
    for i,bu in ban_unit.items():
        g=bu['g']
        for u in bu['units']:
            for (d,p),var in u['cells'].items(): raw[(bu['t'],d,RT[g][p])].append(var)
    occ={}
    for (t,d,rt),vs in raw.items():
        if not vs: continue
        b=cm.NewBoolVar(f'occ_{t}_{d}_{rt}'); cm.AddMaxEquality(b,vs); occ[(t,d,rt)]=b
    return occ

def _step_cost(cm, count_terms, tag, weight):
    # count_terms: 불리언 변수 리스트. 주당 발생 횟수 n에 대해 1회=1,2회=2,3회=4,4회=8,5회=16 (2배씩) ×weight
    # 비용 = ge1 + ge2 + 2*ge3 + 4*ge4 + 8*ge5  (= 1,2,4,8,16 누적)
    if not count_terms: return 0
    n=cm.NewIntVar(0,len(count_terms),f'n_{tag}'); cm.Add(n==sum(count_terms))
    ges=[]
    for k,add in [(1,1),(2,1),(3,2),(4,4),(5,8)]:
        gk=cm.NewBoolVar(f'ge{k}_{tag}')
        cm.Add(n>=k).OnlyEnforceIf(gk); cm.Add(n<=k-1).OnlyEnforceIf(gk.Not())
        ges.append(add*gk)
    return weight*sum(ges)

def discomfort_terms(cm, occ, teachers, weights, teacher_hours):
    def w(k): return int(weights.get(k, 1))
    # occ는 실시간(rt) 기준. rt: 1교시=rt1 … 7교시=rt8. rt4=1·2학년 4교시, rt5=3학년 4교시.
    RT_BY_DAY={0:[2,3,4,5,6,7,8],1:[1,2,3,4,5,6,7,8],2:[1,2,3,4,5],3:[1,2,3,4,5,6,7,8],4:[1,2,3,4,5,6,7,8]}
    # 점심 끼임도 연강으로 보는 인접관계 (실시간): 4→6(1·2학년 점심넘김), 3→5(3학년 점심넘김), 5→6 포함
    ADJ_PAIRS={(1,2),(2,3),(3,4),(3,5),(4,6),(5,6),(6,7),(7,8)}
    def chains_len(L):
        res=[]; allrt=[1,2,3,4,5,6,7,8]
        def ext(path):
            if len(path)==L: res.append(tuple(path)); return
            for nxt in allrt:
                if nxt>path[-1] and (path[-1],nxt) in ADJ_PAIRS: ext(path+[nxt])
        for s0 in allrt: ext([s0])
        return res
    CH3=chains_len(3)
    pen={}
    for t in teachers:
        terms=[]
        # (A) 하루 시수 점수: 각 요일 (그날 수업시수 − 그날 최대허용시수). 최대보다 1시간 적을 때마다 -1점.
        #     예: 수요일(최대3) 2시간=-1, 1시간=-2, 0시간=-3.  (수업이 많을수록 0에 가까움)
        DAILY_MAX={0:4,1:5,2:3,3:5,4:5}
        for d in range(5):
            cnt=[occ[(t,d,rt)] for rt in RT_BY_DAY[d] if (t,d,rt) in occ]
            n=cm.NewIntVar(0,8,f'n_{t}_{d}'); cm.Add(n==(sum(cnt) if cnt else 0))
            terms.append(w('over4')*(n - DAILY_MAX[d]))
        # (B) 1교시(rt1) 있는 날 수 n → (n-2)점. 2일=0, 3일=1 (하드 제약으로 2~3일만 가능, 화수목금 중)
        first_days=[occ[(t,d,1)] for d in [1,2,3,4] if (t,d,1) in occ]
        if first_days:
            terms.append(w('firstlast')*(sum(first_days) - 2))
        # (C) 7교시(rt8) 있는 날 수 n → (n-2)점. 2일=0, 3일=1 (하드 제약으로 2~3일만 가능, 월화목금 중)
        last_days=[occ[(t,d,8)] for d in [0,1,3,4] if (t,d,8) in occ]
        if last_days:
            terms.append(w('firstlast')*(sum(last_days) - 2))
        # (D) 점심끼임: 주당 횟수 1=1,2=2,3=4,4=8,5=16. 끼임 = 그 날 점심 직전·직후 모두 수업.
        #     1·2학년 점심: rt4(4교시) 직후 rt6(5교시). 3학년 점심: rt3(3교시) 직후 rt5(4교시).
        lunch_days=[]
        for d in range(5):
            day_lunch=[]
            if (t,d,4) in occ and (t,d,6) in occ:
                lp=cm.NewBoolVar(f'lunA_{t}_{d}')
                cm.AddBoolAnd([occ[(t,d,4)],occ[(t,d,6)]]).OnlyEnforceIf(lp)
                cm.AddBoolOr([occ[(t,d,4)].Not(),occ[(t,d,6)].Not()]).OnlyEnforceIf(lp.Not())
                day_lunch.append(lp)
            if (t,d,3) in occ and (t,d,5) in occ:
                lp=cm.NewBoolVar(f'lunB_{t}_{d}')
                cm.AddBoolAnd([occ[(t,d,3)],occ[(t,d,5)]]).OnlyEnforceIf(lp)
                cm.AddBoolOr([occ[(t,d,3)].Not(),occ[(t,d,5)].Not()]).OnlyEnforceIf(lp.Not())
                day_lunch.append(lp)
            if day_lunch:
                dl=cm.NewBoolVar(f'lunday_{t}_{d}'); cm.AddMaxEquality(dl,day_lunch); lunch_days.append(dl)
        terms.append(_step_cost(cm, lunch_days, f'lun_{t}', w('lunch')))
        # (E) 3연강(점심 끼임 포함): 주당 횟수 1=1,2=2,3=4,4=8,5=16. 연속 3칸 사슬 점유.
        run3_starts=[]
        for d in range(5):
            for ch in CH3:
                if all((t,d,rt) in occ for rt in ch):
                    r3=cm.NewBoolVar(f'r3_{t}_{d}_{ch[0]}_{ch[2]}')
                    cm.AddBoolAnd([occ[(t,d,rt)] for rt in ch]).OnlyEnforceIf(r3)
                    cm.AddBoolOr([occ[(t,d,rt)].Not() for rt in ch]).OnlyEnforceIf(r3.Not())
                    run3_starts.append(r3)
        terms.append(_step_cost(cm, run3_starts, f'run_{t}', w('run3')))
        if terms:
            lo, hi = score_bounds(weights, teacher_hours.get(t, 0))
            P=cm.NewIntVar(lo,hi,f'pen_{t}'); cm.Add(P==sum(terms)); pen[t]=P
    return pen


def extract(m, solver, slot, blocks, y, ban_unit):
    positions = {}
    slots = []
    for (g, bc, si), cells in slot.items():
        for (d, p), v in cells.items():
            if solver.Value(v):
                positions[g, bc, si] = d, p
                slots.append(dict(g=g, block=bc, slot=si, d=d, p=p))
    sp, bp, up = [], [], []
    for i, row in enumerate(m['blocks']):
        g, bc = row['grade'], row['block']
        for si in range(blocks[g, bc]['len']):
            if solver.Value(y[i, si]):
                d, p = positions[g, bc, si]
                sp.append(dict(g=g, block=bc, div=row['div'], sub=row['subject'], t=row['teacher'], d=d, p=p, rowId=row['rowId']))
    for i, bu in ban_unit.items():
        for u in bu['units']:
            base = dict(g=bu['g'], cls=bu['cls'], sub=bu['sub'], t=bu['t'], rowId=m['bans'][i]['rowId'])
            hit = [(d,p) for (d,p), v in u['cells'].items() if solver.Value(v)]
            if hit:
                d, p = hit[0]
                bp.append(dict(base, d=d, p=p))
            else:
                up.append(base)
    return dict(SEC_PLACE=sp, BAN_PLACE=bp, UNPLACED=up, blockSlots=slots)


def solve(m, options, limits, progress=None, solver_factory=cp_model.CpSolver, warm_start=None):
    """Only strict-stage solutions can be adopted; starting points are soft hints."""
    result = {'stages': [], 'status': 'UNKNOWN', 'adoptedStage': None}
    start_hint, strict_hint, best_placed, best_max = {}, {}, None, None
    start_limit = options.get('startLimit', 0)
    initial = dict(stage='0', relaxed='daily_min', status='SKIPPED', objective=None, wall_time=0, adopted=False)
    result['stages'].append(initial)
    if warm_start is not None:
        hints.validate_result(warm_start)
        initial['reason'] = 'previous_result'
    elif start_limit > 0:
        initial['status'] = 'RUNNING'
        if progress:
            progress(dict(state='실행 중', stage='0', stages=result['stages']))
        cm, slot, blocks, secs_b, y, ban_unit, place, total, placed = build(
            m, options['pairAllowList'], options['gangsaDayCount'], options['blockTimeBan'], options['dependents'], daily_min=False)
        cm.Maximize(placed)
        s0 = solver_factory()
        s0.parameters.max_time_in_seconds = start_limit
        s0.parameters.num_search_workers = 16
        s0.parameters.num_violation_ls = 1
        status = s0.Solve(cm)
        valid = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        initial.update(status=s0.StatusName(status), objective=s0.ObjectiveValue() if valid else None, wall_time=s0.WallTime())
        if valid:
            start_hint = hints.capture(s0, slot, y, ban_unit)
        result['warmStart'] = dict(source='relaxed_daily_min', hintedVariables=len(start_hint))
    else:
        initial['reason'] = 'zero_limit'
    teachers = [t for t in m['teachers'] if t not in m['gangsa']]
    bounds = [score_bounds(options['weights'], m['teacherTotal'].get(t, 0)) for t in teachers]
    lo = min([b[0] for b in bounds] or [0])
    hi = max([b[1] for b in bounds] or [0])
    for index, name in enumerate(('1', '2', '2.5')):
        if index and (limits[index] == 0 or (index == 2 and best_max is None)):
            result['stages'].append(dict(stage=name, status='SKIPPED', objective=None, wall_time=0, adopted=False))
            continue
        if progress:
            progress(dict(state='실행 중', stage=name, stages=result['stages']))
        cm, slot, blocks, secs_b, y, ban_unit, place, total, placed = build(
            m, options['pairAllowList'], options['gangsaDayCount'], options['blockTimeBan'], options['dependents'])
        pen = None
        if index == 0:
            if warm_start is not None:
                start_hint, result['warmStart'] = hints.from_result(m, warm_start, slot, y, ban_unit)
            hints.apply(cm, slot, y, ban_unit, start_hint)
            cm.Maximize(placed)
        else:
            cm.Add(placed == best_placed)
            hints.apply(cm, slot, y, ban_unit, strict_hint)
            occ = teacher_occupancy(cm, slot, blocks, secs_b, y, ban_unit, place, m['teachers'])
            pen = discomfort_terms(cm, occ, teachers, options['weights'], m['teacherTotal'])
            maxpen = cm.NewIntVar(lo, hi, 'maxpen')
            for v in pen.values():
                cm.Add(maxpen >= v)
            if index == 1:
                cm.Minimize(maxpen)
            else:
                cm.Add(maxpen <= best_max)
                total_pen = cm.NewIntVar(sum(b[0] for b in bounds), sum(b[1] for b in bounds), 'totpen')
                cm.Add(total_pen == sum(pen.values()))
                cm.Minimize(total_pen)
        s = solver_factory()
        s.parameters.max_time_in_seconds = limits[index]
        s.parameters.num_search_workers = 16 if index == 0 else 8
        if index == 0:
            s.parameters.num_violation_ls = 1
        status = s.Solve(cm)
        valid = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        stage = dict(stage=name, status=s.StatusName(status), objective=s.ObjectiveValue() if valid else None,
                     wall_time=s.WallTime(), adopted=False)
        result['stages'].append(stage)
        if valid:
            for prior in result['stages']:
                prior['adopted'] = False
            stage['adopted'] = True
            result.update(extract(m, s, slot, blocks, y, ban_unit))
            result.update(status='SUCCESS', adoptedStage=name, total=total, placed=int(s.Value(placed)))
            if index == 0:
                best_placed = int(s.Value(placed))
                strict_hint = hints.capture(s, slot, y, ban_unit, include_bans=False)
            elif index == 1:
                best_max = int(s.Value(maxpen))
            if pen is not None:
                result['scores'] = {t: int(s.Value(v)) for t, v in pen.items()}
        elif index == 0:
            result['status'] = stage['status']
            break
    if result['status'] == 'SUCCESS' and 'scores' not in result:
        # Evaluate the same CP expressions on the adopted first-stage occupancy.
        cm = cp_model.CpModel()
        occ = {}
        for row in result['SEC_PLACE'] + result['BAN_PLACE']:
            key = row['t'], row['d'], RT[row['g']][row['p']]
            occ[key] = cm.NewConstant(1)
        # Candidate keys matter for the notebook's first/last terms.
        for row in m['blocks'] + m['bans']:
            for d, p in cf():
                key = row['teacher'], d, RT[row['grade']][p]
                if key not in occ:
                    occ[key] = cm.NewConstant(0)
        penalties = discomfort_terms(cm, occ, teachers, options['weights'], m['teacherTotal'])
        evaluator = cp_model.CpSolver()
        evaluator.Solve(cm)
        result['scores'] = {t: int(evaluator.Value(v)) for t, v in penalties.items()}
    return result
