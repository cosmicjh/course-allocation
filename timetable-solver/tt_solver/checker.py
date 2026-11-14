"""Independent result checker: never imports the CP-SAT engine."""
from collections import Counter, defaultdict
from .calendar import CELLS, PBD, RT


def chains(length):
    rails = ([1,2,3,4,6,7,8], [1,2,3,5,6,7,8])
    return sorted({tuple(rail[i:i+length]) for rail in rails for i in range(len(rail)-length+1)})


def check(model, result, options):
    errors = []
    def require(ok, message):
        if not ok:
            errors.append(message)
    source = {r.get('rowId', f'{kind}:{i}'): (kind, r) for kind in ('blocks', 'bans') for i, r in enumerate(model[kind])}
    slots = result.get('blockSlots', [])
    lengths = {(r['grade'], r['block']): r['blockLen'] for r in model['blocks']}
    slot_by = defaultdict(list)
    grade_block = Counter()
    seen_slot = set()
    for r in slots:
        try:
            g, bc, si, d, p = (r[k] for k in ('g', 'block', 'slot', 'd', 'p'))
            require((g,bc) in lengths and type(si) is int and 0 <= si < lengths.get((g,bc),0), '未知 블록 슬롯')
            require((d,p) in CELLS, '블록 시간 범위')
            require((g,bc,si) not in seen_slot, '블록 슬롯 번호 중복')
            seen_slot.add((g,bc,si))
            slot_by[g,bc].append((d,p))
            grade_block[g,d,p] += 1
            require([d,p] not in options.get('blockTimeBan', {}).get(bc, []), '블록 금지 칸')
        except (KeyError, TypeError):
            errors.append('블록 슬롯 형식 오류')
    for key, n in lengths.items():
        cells = slot_by[key]
        require(len(cells) == n and len({d for d,p in cells}) == n, '블록 슬롯 수/하루 1회')
    require(all(v == 1 for v in grade_block.values()), '동일 학년 블록 중복')
    occupancy, section_cells, cls_cells = Counter(), Counter(), Counter()
    hours, groups, moving = Counter(), defaultdict(list), set()
    valid_rows = []
    for kind, key in (('blocks','SEC_PLACE'), ('bans','BAN_PLACE'), ('bans','UNPLACED')):
        for r in result.get(key, []):
            try:
                original_kind, original = source[r['rowId']]
                require(original_kind == kind, '배당행 종류 불일치')
                require(all(r[k] == original[v] for k,v in [('g','grade'),('sub','subject'),('t','teacher')] + ([('block','block'),('div','div')] if kind == 'blocks' else [('cls','cls')])), '배당행 내용 변조')
                if key == 'UNPLACED':
                    require(False, '미배치 시수 존재')
                    continue
                d,p,g,t = r['d'],r['p'],r['g'],r['t']
                require(type(d) is int and type(p) is int and (d,p) in CELLS, '수업 시간 범위')
                rt = RT[g][p]
                occupancy[t,d,rt] += 1
                hours[r['rowId']] += 1
                valid_rows.append(r)
                if kind == 'blocks':
                    require((d,p) in slot_by[g,r['block']], '이동수업과 블록 슬롯 불일치')
                    section_cells[g,r['block'],r['div'],r['sub'],d,p] += 1
                    moving.add((g,r['sub'],d,p))
                else:
                    cls_cells[g,r['cls'],d,p] += 1
                    groups[g,r['cls'],r['sub'],t,bool(original.get('art'))].append((d,p))
                    if t in options.get('buja', model['buja']) and '진로' not in r['sub']:
                        require((d,p) != (4,1), '부장 금1')
                    if g == '3' and '진로' in r['sub']:
                        require((d,p) == (4,1), '3학년 진로 금1')
            except (KeyError, TypeError, ValueError):
                errors.append('결과 행 형식/rowId 오류')
    require(all(v == 1 for v in occupancy.values()), '교사 실제 시간 중복')
    require(all(v == 1 for v in section_cells.values()), '동일 (div, 과목) 슬롯 중복')
    for rid, (_, row) in source.items():
        require(hours[rid] == row['hours'], '배당행 시수 불일치: ' + rid)
    classes = {(r['grade'],r['cls']) for r in model['bans']}
    classes.update((g,str(c)) for g,n in model.get('classes', {}).items() for c in range(1,n+1))
    for g,cls in classes:
        for d,p in CELLS:
            require(cls_cells[g,cls,d,p] + grade_block[g,d,p] == 1, '학급 31칸 빈칸/중복')
    gangsa = set(options.get('gangsa', model['gangsa']))
    for (g,cls,sub,t,art), cells in groups.items():
        daily = Counter(d for d,p in cells)
        if art:
            pairs = sum((d,p+1) in cells for d,p in cells if p != 4 and p+1 in PBD[d])
            require(max(daily.values(), default=0) <= 2 and pairs == 1, '미술 2+1 연강')
        elif t not in gangsa:
            allow = sub in options.get('pairAllowList', [])
            require(max(daily.values(), default=0) <= (2 if allow else 1), '하루 과목 횟수')
            if allow:
                require(all(d != e or abs(p-q) >= 3 for i,(d,p) in enumerate(cells) for e,q in cells[i+1:]), '하루 2회 교시 차이 3 이상')
    for dep in options.get('dependents', []):
        for g,sub,d,p in moving:
            if sub == dep['subject']:
                require(not any((g,follow,d,p) in moving for follow in dep['follows']), '종속 과목 중복')
    scores = {}
    for t in model['teachers']:
        actual = {(d,rt) for name,d,rt in occupancy if name == t}
        if t in gangsa:
            limit = options.get('gangsaDayCount', {}).get(t,5)
            require(len({d for d,rt in actual}) <= limit, '강사 출근일수 상한')
            continue
        first = sum((d,1) in actual for d in (1,2,3,4))
        last = sum((d,8) in actual for d in (0,1,3,4))
        require(2 <= first <= 3 and 2 <= last <= 3, '일반교사 1·7교시 일수')
        candidates = {(d,RT[r['grade']][p]) for r in model['blocks']+model['bans'] if r['teacher'] == t for d,p in CELLS}
        daily = [sum(day == d for day,rt in actual) for d in range(5)]
        for d, maximum in enumerate((4,5,3,5,5)):
            if any(day == d for day,rt in candidates):
                require(2 <= daily[d] <= maximum, '일반교사 요일별 시수')
            require(not ((d,4) in actual and (d,5) in actual), '점심 보장')
            require(not any(all((d,rt) in actual for rt in ch) for ch in chains(4)), '최대 3연강')
        lunches = sum(((d,4) in actual and (d,6) in actual) or ((d,3) in actual and (d,5) in actual) for d in range(5))
        runs = sum(all((d,rt) in actual for rt in ch) for d in range(5) for ch in chains(3))
        step = lambda n: 0 if n == 0 else 2**(min(n,5)-1)
        weights = options.get('weights', {})
        value = weights.get('over4',1) * (sum(daily)-22)
        if any((d,1) in candidates for d in (1,2,3,4)):
            value += weights.get('firstlast',1)*(first-2)
        if any((d,8) in candidates for d in (0,1,3,4)):
            value += weights.get('firstlast',1)*(last-2)
        value += weights.get('lunch',1)*step(lunches) + weights.get('run3',1)*step(runs)
        scores[t] = value
    require(scores == result.get('scores'), '불편 점수 재계산 불일치')
    return dict(ok=not errors, status='검증 통과' if not errors else '검증 실패', errors=sorted(set(errors)), scores=scores)
