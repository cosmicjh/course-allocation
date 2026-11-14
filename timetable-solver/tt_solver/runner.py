import hashlib
import json
import os
from pathlib import Path
import traceback
import time


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def atomic_json(path, value):
    path = Path(path)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    # Windows readers briefly deny replacing an open file; keep the atomic commit.
    deadline = time.monotonic() + 1
    while True:
        try:
            os.replace(temp, path)
            break
        except PermissionError:
            if os.name != 'nt' or time.monotonic() >= deadline:
                raise
            time.sleep(.01)


def run(model, options, out, limits=(1800,600,120), warm_start=None, start_limit=None):
    from .validation import validate
    from .engine import solve
    from .checker import check
    from .excel import write_excel
    from .hints import validate_result
    if start_limit is not None and isinstance(options, (dict, type(None))):
        options = dict(options or {}, startLimit=start_limit)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    atomic_json(out/'model.json', model)
    atomic_json(out/'options.json', options or {})
    if warm_start is not None:
        atomic_json(out/'warm-start.json', warm_start)
    def progress(update):
        atomic_json(out/'status.json', dict(id=out.name, pid=os.getpid(), **update))
        with (out/'log.txt').open('a', encoding='utf-8') as log:
            log.write(json.dumps({k:v for k,v in update.items() if k != 'result'}, ensure_ascii=False) + '\n')
    progress(dict(state='실행 중', stage='사전 검증', stages=[]))
    try:
        normalized, effective, errors = validate(model, options, limits)
        if warm_start is not None:
            try:
                validate_result(warm_start)
            except ValueError as error:
                errors.append(str(error))
        result = dict(modelHash=hashlib.sha256(json.dumps(model, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest(), options=effective or options or {}, stages=[], checker={'ok':None,'status':'미실행','errors':[]})
        if errors:
            result.update(status='VALIDATION_ERROR', errors=errors)
        else:
            result.update(solve(normalized, effective, limits, progress, warm_start=warm_start))
            if result['status'] == 'SUCCESS':
                result['checker'] = check(normalized, result, effective)
                if not result['checker']['ok']:
                    result['status'] = '검증 실패'
                write_excel(normalized, result, out/'result.xlsx')
        atomic_json(out/'result.json', result)
        progress(dict(state=result['status'], stage=result.get('adoptedStage'), stages=result['stages'], result=result))
        return result
    except Exception:
        # Detailed errors remain in the local per-run log, never in public assets.
        traceback.print_exc()
        progress(dict(state='ERROR', error='실행 오류입니다. 이 실행의 log.txt를 확인하세요.', stages=[]))
        raise
