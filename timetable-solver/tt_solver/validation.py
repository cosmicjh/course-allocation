"""Input boundary; calendar v1 deliberately matches the notebook."""
from collections import Counter
from copy import deepcopy

DEFAULT_OPTIONS = {
    'startLimit': 0,
    'weights': dict.fromkeys(('over4', 'run3', 'lunch', 'firstlast'), 1),
    'pairAllowList': [], 'gangsaDayCount': {}, 'blockTimeBan': {},
    'dependents': [
        {'subject': '스포츠과학', 'follows': ['음악감상과비평(2학년)', '미술감상과비평(2학년)']},
        {'subject': '공강(3학년)', 'follows': ['운동과건강(3학년)']},
    ],
}


def score_bounds(weights, hours):
    # Every term is bounded, including negative over4 and first/last constants.
    a = abs(int(weights.get('over4', 1))) * (hours + 22)
    b = abs(int(weights.get('firstlast', 1))) * 4
    c = 16 * (abs(int(weights.get('lunch', 1))) + abs(int(weights.get('run3', 1))))
    return -a-b-c, a+b+c


def validate(model, overrides=None, limits=(1800, 600, 120)):
    errors = []
    m = deepcopy(model)
    if not isinstance(m, dict):
        return None, None, ['모델은 JSON 객체여야 합니다.']
    if m.get('_type') != '시간표_솔버모델' or type(m.get('_version')) is not int or m['_version'] != 1:
        errors.append('시간표_솔버모델 버전 1 JSON을 선택하세요.')
    for key in ('teachers', 'buja', 'gangsa', 'blocks', 'bans'):
        if not isinstance(m.get(key), list):
            errors.append(f'{key}: 필수 배열이 없습니다.')
    if errors:
        return None, None, errors
    if any(not isinstance(t, str) or not t.strip() for t in m['teachers']):
        return None, None, ['teachers: 교사 이름은 비어 있지 않은 문자열이어야 합니다.']
    if len(set(m['teachers'])) != len(m['teachers']):
        errors.append('teachers: 비어 있거나 중복된 교사 이름입니다.')
    options = deepcopy(DEFAULT_OPTIONS)
    for source in (m.get('options', {}), overrides or {}):
        if not isinstance(source, dict):
            errors.append('options는 객체여야 합니다.')
            continue
        options.update(source)
    for role in ('buja', 'gangsa'):
        if role in options:
            m[role] = options[role]
        if not isinstance(m[role], list) or any(t not in m['teachers'] for t in m[role]):
            errors.append(f'{role}: teachers에 있는 이름의 배열이어야 합니다.')
    options['buja'], options['gangsa'] = m['buja'], m['gangsa']
    start_limit = options.get('startLimit')
    if type(start_limit) not in (int, float) or not 0 <= start_limit <= 86400:
        errors.append('0단계 제한 시간은 0~86400초 숫자여야 합니다.')
    weights = options.get('weights')
    if not isinstance(weights, dict) or any(type(v) is not int or abs(v) > 1000000 for v in weights.values()):
        errors.append('가중치는 절댓값 1000000 이하 정수여야 합니다.')
    if not isinstance(options.get('pairAllowList'), list) or any(not isinstance(s, str) for s in options['pairAllowList']):
        errors.append('pairAllowList는 과목명 배열이어야 합니다.')
    gd = options.get('gangsaDayCount')
    if not isinstance(gd, dict) or any(t not in m['gangsa'] or type(n) is not int or not 1 <= n <= 5 for t, n in gd.items()):
        errors.append('강사 출근일수는 지정 강사의 1~5일 상한이어야 합니다.')
    deps = options.get('dependents')
    if not isinstance(deps, list) or any(not isinstance(d, dict) or not isinstance(d.get('subject'), str) or not isinstance(d.get('follows'), list) or any(not isinstance(s, str) for s in d['follows']) for d in deps):
        errors.append('dependents는 subject와 follows 배열을 가진 객체 배열이어야 합니다.')
    from .calendar import CELLS
    bt = options.get('blockTimeBan')
    if not isinstance(bt, dict) or any(not isinstance(cells, list) or any(not isinstance(c, (list, tuple)) or len(c) != 2 or any(type(v) is not int for v in c) or tuple(c) not in CELLS for c in cells) for cells in bt.values()):
        errors.append('블록 금지 칸은 블록별 [요일 0~4, 교시] 배열이어야 합니다.')
    if not isinstance(limits, (list, tuple)) or len(limits) != 3 or any(type(n) not in (int, float) or not 0 <= n <= 86400 for n in limits):
        errors.append('단계 제한 시간은 0~86400초 숫자 3개여야 합니다.')
    options['limits'] = list(limits) if isinstance(limits, (list, tuple)) else []
    flags = m.get('flags', [])
    if not isinstance(flags, list) or any(not isinstance(f, str) for f in flags):
        errors.append('flags는 문자열 배열이어야 합니다.')
    elif any('배치 초과' in f for f in flags):
        errors.append('배치 초과: 교과배당표의 블록·교사 시수 합을 블록 길이 이내로 수정한 뒤 새 JSON을 내보내세요.')
    lengths, sums, totals = {}, Counter(), Counter()
    ids = set()
    for kind in ('blocks', 'bans'):
        for i, row in enumerate(m[kind]):
            label = f'{kind}[{i}]'
            keys = ('grade', 'subject', 'teacher', 'hours') + (('block', 'blockLen', 'div') if kind == 'blocks' else ('cls',))
            if not isinstance(row, dict) or any(k not in row for k in keys):
                errors.append(label + (': 분반 세부코드(div)가 없습니다. 최신 웹 도구에서 교과배당표를 다시 올리고 새 모델 JSON을 내보내세요.' if isinstance(row, dict) and kind == 'blocks' and 'div' not in row else ': 필수 필드가 없습니다.'))
                continue
            row.setdefault('rowId', f'{kind}:{i}')
            rid = row['rowId']
            if not isinstance(rid, str) or not rid or rid in ids:
                errors.append(label + ': rowId는 고유한 문자열이어야 합니다.')
            else:
                ids.add(rid)
            if row['grade'] not in ('1', '2', '3') or row['teacher'] not in m['teachers'] or any(not isinstance(row[k], str) or not row[k] for k in ('subject', 'teacher') + (('block', 'div') if kind == 'blocks' else ('cls',))):
                errors.append(label + ': 학년·교사·과목·학급/분반을 확인하세요.')
                continue
            if type(row['hours']) is not int or not 1 <= row['hours'] <= 1000:
                errors.append(label + ': 시수는 1~1000 정수여야 합니다.')
                continue
            totals[row['teacher']] += row['hours']
            if kind == 'blocks':
                k = (row['grade'], row['block'])
                n = row['blockLen']
                if type(n) is not int or not 1 <= n <= 5:
                    errors.append(label + ': blockLen은 1~5 정수여야 합니다.')
                    continue
                if k in lengths and lengths[k] != n:
                    errors.append(label + ': blockLen 불일치')
                lengths[k] = n
                sums[(k, 'teacher', row['teacher'])] += row['hours']
                sums[(k, 'section', row['div'], row['subject'])] += row['hours']
            elif 'art' in row and type(row['art']) is not bool:
                errors.append(label + ': art는 불리언이어야 합니다.')
    for key, count in sums.items():
        if count > lengths[key[0]]:
            errors.append(f'{key[0]}: 교사 또는 (div, 과목) 합이 blockLen을 초과합니다.')
    classes = m.get('classes')
    if classes is not None:
        if not isinstance(classes, dict) or any(g not in ('1', '2', '3') or type(n) is not int or not 0 <= n <= 100 for g, n in classes.items()):
            errors.append('classes는 학년별 학급 수 객체여야 합니다.')
        elif not errors:
            for row in m['blocks']:
                if classes.get(row['grade']) == 0:
                    errors.append('이동수업의 학년에 학급이 없습니다.')
            for row in m['bans']:
                if row['grade'] not in classes or row['cls'] not in [str(i) for i in range(1, classes[row['grade']]+1)]:
                    errors.append('반수업의 학급이 classes에 없습니다.')
            for g, count in classes.items():
                block_hours = sum(n for (grade, _), n in lengths.items() if grade == g)
                for cls in range(1, count+1):
                    h = sum(r['hours'] for r in m['bans'] if r['grade'] == g and r['cls'] == str(cls))
                    if h + block_hours != 31:
                        errors.append(f'{g}-{cls}: 주간 합 {h + block_hours}, 31이어야 합니다.')
    m['teacherTotal'] = dict(totals)
    return m, options, errors
