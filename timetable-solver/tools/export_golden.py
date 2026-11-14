"""Synthetic fixtures only. Run from the repository root; see the JS test header."""
import argparse
import copy
import json
from pathlib import Path
from google.protobuf.json_format import MessageToDict
from ortools.sat import cp_model_pb2
from ortools.sat.python import cp_model
from tt_solver import engine, checker, hints
from tt_solver.validation import validate, score_bounds
from tt_solver.calendar import CELLS


def cases():
    base = dict(_type='시간표_솔버모델', _version=1, teachers=['가상강사'], buja=[], gangsa=['가상강사'],
                blocks=[dict(grade='2', block='2A', blockLen=2, div='2A1', subject='선택', teacher='가상강사', hours=2)], bans=[])
    yield 'small', base, {}
    m = copy.deepcopy(base)
    m['teachers'].append('가상강사2'); m['gangsa'].append('가상강사2')
    m['blocks'][0]['hours'] = 1
    m['blocks'].append(dict(m['blocks'][0], div='2A2', teacher='가상강사2'))
    yield 'sections', m, {'blockTimeBan': {'2A': [[4,6],[4,7]]}}
    m = copy.deepcopy(base)
    m['teachers'].append('가상강사2'); m['gangsa'].append('가상강사2')
    m['blocks'].append(dict(m['blocks'][0], grade='3', block='3B', div='3B1', subject='후속', teacher='가상강사2'))
    m['blocks'][0]['subject'] = '주과목'
    m['blocks'].append(dict(m['blocks'][1], grade='2', block='2B', div='2B1'))
    yield 'dependents', m, {'dependents': [{'subject':'주과목','follows':['후속']}], 'gangsaDayCount':{'가상강사':3}}
    full = copy.deepcopy(base); full['blocks']=[]; full['classes']={'1':1,'2':0,'3':0}
    full['bans']=[dict(grade='1',cls='1',subject='수업',teacher='가상강사',hours=28,art=False),
                  dict(grade='1',cls='1',subject='미술',teacher='가상강사',hours=3,art=True)]
    yield 'art', full, {}
    m=copy.deepcopy(full);m['classes']={'1':0,'2':0,'3':1};m['buja']=['가상강사']
    m['bans']=[dict(r,grade='3',hours=30 if i==0 else 1,subject='수업' if i==0 else '진로',art=False) for i,r in enumerate(m['bans'])]
    yield 'lead-career',m,{}
    m=copy.deepcopy(full);m['teachers'].append('가상교사');m['bans']=m['bans'][:1];m['bans'][0]['hours']=19
    m['bans'] += [dict(grade='1',cls='1',subject=f'과목{i}',teacher='가상교사',hours=1,art=False) for i in range(12)]
    m['bans'][9]['subject']=m['bans'][11]['subject']='분리'
    yield 'normal-pair',m,{'pairAllowList':['분리'],'weights':{'over4':-2,'lunch':3,'run3':2,'firstlast':4}}


def export(raw, overrides, target, name, previous=None):
    m,o,errors=validate(raw,overrides); assert not errors,errors
    target.mkdir(parents=True,exist_ok=True)
    def write(file,value): (target/file).write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    write('input.json',dict(model=raw,options=overrides))
    strict={}; best_placed=sum(r['hours'] for r in m['bans']); best_max=0
    result=None
    for stage in ('0','1','2','2.5'):
        v=engine.build(m,o['pairAllowList'],o['gangsaDayCount'],o['blockTimeBan'],o['dependents'],daily_min=stage!='0')
        cm,slot,blocks,sb,y,bu,place,total,placed=v
        pen=None
        if stage in ('0','1'):
            if stage=='1' and previous is not None:
                hint,stats=hints.from_result(m,previous,slot,y,bu);hints.apply(cm,slot,y,bu,hint)
                write('warm-start.json',previous);write('warm-stats.json',stats)
            cm.Maximize(placed)
        else:
            cm.Add(placed==best_placed);hints.apply(cm,slot,y,bu,strict)
            teachers=[t for t in m['teachers'] if t not in m['gangsa']]
            bounds=[score_bounds(o['weights'],m['teacherTotal'].get(t,0)) for t in teachers]
            occ=engine.teacher_occupancy(cm,slot,blocks,sb,y,bu,place,m['teachers'])
            pen=engine.discomfort_terms(cm,occ,teachers,o['weights'],m['teacherTotal'])
            mx=cm.NewIntVar(min([b[0] for b in bounds] or [0]),max([b[1] for b in bounds] or [0]),'maxpen')
            for p in pen.values():cm.Add(mx>=p)
            if stage=='2':cm.Minimize(mx)
            else:
                cm.Add(mx<=best_max);tot=cm.NewIntVar(sum(b[0] for b in bounds),sum(b[1] for b in bounds),'totpen');cm.Add(tot==sum(pen.values()));cm.Minimize(tot)
        path=target/f'{stage}.bin';assert cm.export_to_file(str(path))
        pb=cp_model_pb2.CpModelProto.FromString(path.read_bytes())
        write(f'{stage}.json',MessageToDict(pb))
        if stage=='1':
            s=cp_model.CpSolver();s.parameters.max_time_in_seconds=20;s.parameters.num_search_workers=1
            status=s.Solve(cm);assert status in (cp_model.OPTIMAL,cp_model.FEASIBLE),(name,s.StatusName(status))
            strict=hints.capture(s,slot,y,bu,include_bans=False);write('strict-hint.json',strict)
            best_placed=int(s.Value(placed));result=engine.extract(m,s,slot,blocks,y,bu)
        if stage=='2':best_max=0  # A fixed cap is sufficient for proto parity; no solve needed.
    result['scores']=checker.check(m,result,o)['scores']
    variants=[result]
    broken=copy.deepcopy(result)
    rows=broken['BAN_PLACE'] or broken['SEC_PLACE'];rows.append(copy.deepcopy(rows[0]));variants.append(broken)
    broken=copy.deepcopy(result);(broken['BAN_PLACE'] or broken['SEC_PLACE'])[0]['rowId']='unknown';variants.append(broken)
    broken=copy.deepcopy(result)
    if broken['blockSlots']:broken['blockSlots'][0]['d']=4;broken['blockSlots'][0]['p']=6
    else:broken['BAN_PLACE'][0]['d']=4;broken['BAN_PLACE'][0]['p']=1
    variants.append(broken)
    write('checker.json',[dict(result=r,expected=checker.check(m,r,o)) for r in variants])
    write('stages.json',dict(bestPlaced=best_placed,bestMax=0))


def checker_rule_cases():
    """Change placements only; every negative must have exactly its target error.

    Recompute scores after timetable changes so score mismatch cannot hide the
    scheduling rule under test. The score-tampering case deliberately skips this.
    """
    fixtures=[]

    def finalize(name, rule, base, broken, recalculate=True):
        m,o,valid=base
        valid=copy.deepcopy(valid)
        valid['scores']=checker.check(m,valid,o)['scores']
        accepted=checker.check(m,valid,o)
        assert accepted['ok'],(name,accepted['errors'])
        if recalculate:
            broken['scores']=checker.check(m,broken,o)['scores']
        rejected=checker.check(m,broken,o)
        assert rejected['errors']==[rule],(name,rejected['errors'])
        fixtures.append(dict(name=name,rule=rule,model=m,options=o,valid=valid,
                             validExpected=accepted,invalid=broken,invalidExpected=rejected))

    def class_fixture(normal=(), grades=('1',), art=(), buja=(), career=False, options=None):
        normal=set(normal);art=set(art)
        raw=dict(_type='시간표_솔버모델',_version=1,teachers=[],buja=list(buja),gangsa=[],
                 blocks=[],bans=[],classes={g:1 for g in grades})
        placements=[]
        for g in grades:
            for d,p in CELLS:
                is_normal=(g,d,p) in normal;is_art=(g,d,p) in art
                t='가상교사' if is_normal else '가상미술강사' if is_art else f'가상강사-{g}-{d}-{p}'
                sub='미술' if is_art else '진로' if career and (d,p)==(4,1) else f'과목-{g}-{d}-{p}'
                row=dict(grade=g,cls='1',subject=sub,teacher=t,hours=1,art=is_art,rowId=f'row-{g}-{d}-{p}')
                raw['bans'].append(row)
                if t not in raw['teachers']:
                    raw['teachers'].append(t)
                    if not is_normal:raw['gangsa'].append(t)
                placements.append(dict(g=g,cls='1',sub=sub,t=t,rowId=row['rowId'],d=d,p=p))
        m,o,errors=validate(raw,options);assert not errors,errors
        return m,o,dict(SEC_PLACE=[],BAN_PLACE=placements,UNPLACED=[],blockSlots=[],scores={})

    def swap(result,a,b):
        x=next(r for r in result['BAN_PLACE'] if (r['g'],r['d'],r['p'])==a)
        y=next(r for r in result['BAN_PLACE'] if (r['g'],r['d'],r['p'])==b)
        assert a[0]==b[0]
        x['d'],x['p'],y['d'],y['p']=y['d'],y['p'],x['d'],x['p']

    def moving_fixture(rows, positions, options=None):
        raw=dict(_type='시간표_솔버모델',_version=1,teachers=list(dict.fromkeys(r['teacher'] for r in rows)),buja=[],gangsa=[],blocks=rows,bans=[])
        raw['gangsa']=raw['teachers'][:]
        m,o,errors=validate(raw,options);assert not errors,errors
        result=dict(SEC_PLACE=[],BAN_PLACE=[],UNPLACED=[],blockSlots=[],scores={})
        seen=set()
        for r,cells in zip(m['blocks'],positions):
            for si,(d,p) in enumerate(cells):
                k=r['grade'],r['block'],si
                if k not in seen:
                    result['blockSlots'].append(dict(g=k[0],block=k[1],slot=si,d=d,p=p));seen.add(k)
                if si<r['hours']:
                    result['SEC_PLACE'].append(dict(g=r['grade'],block=r['block'],div=r['div'],sub=r['subject'],t=r['teacher'],rowId=r['rowId'],d=d,p=p))
        return m,o,result

    def block(g='2',bc='2A',teacher='가상강사',length=2,hours=2,sub='선택',div=None):
        return dict(grade=g,block=bc,blockLen=length,div=div or bc+'1',subject=sub,teacher=teacher,hours=hours)

    def move_block(result,g,bc,si,d,p):
        slot=next(r for r in result['blockSlots'] if (r['g'],r['block'],r['slot'])==(g,bc,si))
        old=slot['d'],slot['p']
        for r in result['SEC_PLACE']:
            if (r['g'],r['block'],r['d'],r['p'])==(g,bc,*old):r.update(d=d,p=p)
        slot.update(d=d,p=p)

    base=moving_fixture([block(length=1,hours=1),block('3','3A',length=1,hours=1)], [[(1,4)],[(1,3)]])
    bad=copy.deepcopy(base[2]);move_block(bad,'3','3A',0,1,2)
    # Same displayed fourth period has different real slots; collide at period 3 instead.
    move_block(bad,'2','2A',0,1,2)
    finalize('teacher-real-overlap','교사 실제 시간 중복',base,bad)

    base=class_fixture();bad=copy.deepcopy(base[2]);bad['BAN_PLACE'][0].update(d=0,p=3)
    finalize('class-hole-and-duplicate','학급 31칸 빈칸/중복',base,bad)

    base=moving_fixture([block()], [[(1,2),(2,2)]]);bad=copy.deepcopy(base[2]);bad['SEC_PLACE'].pop()
    finalize('row-hours','배당행 시수 불일치: blocks:0',base,bad)
    bad=copy.deepcopy(base[2]);move_block(bad,'2','2A',1,1,5)
    finalize('block-different-days','블록 슬롯 수/하루 1회',base,bad)
    base=moving_fixture([block(hours=1)], [[(1,2),(2,2)]]);bad=copy.deepcopy(base[2]);bad['blockSlots'].pop()
    finalize('block-slot-count','블록 슬롯 수/하루 1회',base,bad)

    base=moving_fixture([block(length=1,hours=1),block(bc='2B',teacher='가상강사2',length=1,hours=1)], [[(1,2)],[(2,2)]])
    bad=copy.deepcopy(base[2]);move_block(bad,'2','2B',0,1,2)
    finalize('same-grade-block-overlap','동일 학년 블록 중복',base,bad)

    base=moving_fixture([block(hours=1),block(teacher='가상강사2',hours=1)], [[(1,2),(2,2)],[(1,2),(2,2)]])
    base[2]['SEC_PLACE'][1].update(d=2,p=2)
    bad=copy.deepcopy(base[2]);bad['SEC_PLACE'][1].update(d=1,p=2)
    finalize('section-subject-overlap','동일 (div, 과목) 슬롯 중복',base,bad)

    base=moving_fixture([block()], [[(1,2),(2,2)]],{'blockTimeBan':{'2A':[[4,6]]}})
    bad=copy.deepcopy(base[2]);move_block(bad,'2','2A',0,4,6)
    finalize('block-forbidden-cell','블록 금지 칸',base,bad)

    base=class_fixture(buja=['가상강사-1-0-2']);bad=copy.deepcopy(base[2]);swap(bad,('1',0,2),('1',4,1))
    finalize('lead-friday-first','부장 금1',base,bad)
    base=class_fixture(grades=('3',),career=True);bad=copy.deepcopy(base[2]);swap(bad,('3',4,1),('3',4,2))
    finalize('grade-three-career','3학년 진로 금1',base,bad)

    normal=[('1',d,p) for d,p in [(0,2),(0,7),(1,1),(1,5),(2,1),(2,3),(3,3),(3,7),(4,1),(4,3),(4,5),(4,7)]]
    base=class_fixture(normal)
    bad=copy.deepcopy(base[2]);swap(bad,('1',1,1),('1',1,2));swap(bad,('1',2,1),('1',2,2))
    finalize('first-period-day-count','일반교사 1·7교시 일수',base,bad)
    bad=copy.deepcopy(base[2]);swap(bad,('1',0,7),('1',0,5));swap(bad,('1',3,7),('1',3,5))
    finalize('last-period-day-count','일반교사 1·7교시 일수',base,bad)
    bad=copy.deepcopy(base[2]);swap(bad,('1',0,2),('1',4,2))
    finalize('daily-hours-lower','일반교사 요일별 시수',base,bad)
    upper=class_fixture(normal+[('1',0,3)]);bad=copy.deepcopy(upper[2]);swap(bad,('1',4,3),('1',0,5));swap(bad,('1',4,5),('1',0,6))
    finalize('daily-hours-upper','일반교사 요일별 시수',upper,bad)
    bad=copy.deepcopy(base[2])
    for a,b in [((4,3),(0,3)),((4,5),(0,4)),((1,5),(0,5)),((0,7),(1,5))]:swap(bad,('1',*a),('1',*b))
    finalize('four-consecutive','최대 3연강',base,bad)

    lunch=class_fixture(normal+[('3',1,4)],grades=('1','3'));bad=copy.deepcopy(lunch[2]);swap(bad,('1',1,5),('1',1,4))
    finalize('lunch-two-fourth-periods','점심 보장',lunch,bad)

    art=class_fixture(art=[('1',1,2),('1',1,3),('1',2,2)]);bad=copy.deepcopy(art[2]);swap(bad,('1',1,3),('1',3,2))
    finalize('art-two-plus-one','미술 2+1 연강',art,bad)

    deps=moving_fixture([block(hours=1,sub='주과목'),block(teacher='가상강사2',hours=1,sub='후속')], [[(1,2),(2,2)],[(1,2),(2,2)]],{'dependents':[{'subject':'주과목','follows':['후속']}]})
    deps[2]['SEC_PLACE'][1].update(d=2,p=2);bad=copy.deepcopy(deps[2]);bad['SEC_PLACE'][1].update(d=1,p=2)
    finalize('dependent-subject','종속 과목 중복',deps,bad)

    days=moving_fixture([block('1','1A',length=1,hours=1),block('3','3A',length=1,hours=1)], [[(1,4)],[(1,4)]],{'gangsaDayCount':{'가상강사':1}})
    bad=copy.deepcopy(days[2]);move_block(bad,'3','3A',0,2,4)
    finalize('instructor-days','강사 출근일수 상한',days,bad)

    def same_subject(base,first,second,allow):
        m,o,result=copy.deepcopy(base)
        for r in result['BAN_PLACE']:
            if (r['g'],r['d'],r['p']) in (first,second):
                r['sub']='분리과목';next(x for x in m['bans'] if x['rowId']==r['rowId'])['subject']='분리과목'
        o['pairAllowList']=['분리과목'] if allow else []
        return m,o,result
    pair=same_subject(base,('1',4,1),('1',4,5),True);bad=copy.deepcopy(pair[2]);swap(bad,('1',4,5),('1',4,3))
    finalize('two-per-day-separation','하루 2회 교시 차이 3 이상',pair,bad)
    once=same_subject(base,('1',1,1),('1',4,3),False);bad=copy.deepcopy(once[2]);swap(bad,('1',4,3),('1',1,5))
    finalize('subject-once-per-day','하루 과목 횟수',once,bad)
    bad=copy.deepcopy(base[2]);bad['scores']=checker.check(base[0],bad,base[1])['scores'];bad['scores']['가상교사']+=1
    finalize('score-recalculation','불편 점수 재계산 불일치',base,bad,recalculate=False)
    return fixtures


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',default='tests/fixtures/timetable-cpsat');parser.add_argument('--model');parser.add_argument('--warm-start');args=parser.parse_args()
    root=Path(args.out)
    if args.model:
        cache=Path('.cache/timetable-verify').resolve()
        if not root.resolve().is_relative_to(cache):
            parser.error('--model 출력은 --out .cache/timetable-verify/... 에만 저장할 수 있습니다')
        raw=json.loads(Path(args.model).read_text(encoding='utf-8-sig'));prior=json.loads(Path(args.warm_start).read_text(encoding='utf-8-sig')) if args.warm_start else None
        export(raw,{},root,'external',prior)
    else:
        for name,m,o in cases():export(m,o,root/name,name)
        # Explicit previous-result mapping, including an ignored rowId.
        m=next(cases())[1];prior=json.loads((root/'small/checker.json').read_text(encoding='utf-8'))[0]['result']
        prior['SEC_PLACE'].append(dict(prior['SEC_PLACE'][0],rowId='removed'))
        export(m,{},root/'warm','warm',prior)
        (root/'checker-rules.json').write_text(json.dumps(checker_rule_cases(),ensure_ascii=False,separators=(',',':')),encoding='utf-8')
