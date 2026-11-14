import copy
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from ortools.sat.python import cp_model
from tt_solver.validation import validate, DEFAULT_OPTIONS, score_bounds
from tt_solver.engine import build, solve, extract, discomfort_terms
from tt_solver.checker import check
from tt_solver.runner import run, read_json, atomic_json
from tt_solver.server import make_server, Runs, serve
from tt_solver.excel import write_excel
from tt_solver.calendar import CELLS
import openpyxl


def moving():
    return {'_type':'시간표_솔버모델','_version':1,'teachers':['가상강사'],'buja':[],'gangsa':['가상강사'],
            'blocks':[dict(grade='2',block='2A',blockLen=2,div='2A1',subject='가상선택',teacher='가상강사',hours=2)],'bans':[]}


def full_class(grade='1'):
    m = moving()
    m['blocks'] = []
    m['classes'] = {grade:1}
    m['bans'] = [dict(grade=grade, cls='1',subject='가상수업',teacher='가상강사',hours=31,art=False)]
    return m


NORMAL_CELLS = [(0,2),(0,7),(1,1),(1,5),(2,1),(2,3),(3,3),(3,7),(4,1),(4,3),(4,5),(4,7)]


def normal_class():
    m = full_class()
    m['teachers'].append('가상교사')
    m['bans'][0]['hours'] = 19
    for i in range(12):
        m['bans'].append(dict(grade='1',cls='1',subject=f'가상과목{i}',teacher='가상교사',hours=1,art=False))
    return m


class EngineTests(unittest.TestCase):
    def normalized(self, m, opt=None):
        m, o, errors = validate(m, dict({'startLimit': 0}, **(opt or {})))
        self.assertEqual(errors, [])
        return m,o

    def constrained(self, m, placements=(), opt=None):
        m,o = self.normalized(m,opt)
        values = build(m,o['pairAllowList'],o['gangsaDayCount'],o['blockTimeBan'],o['dependents'])
        cm,slot,blocks,sb,y,bu,place,total,placed=values
        cm.Maximize(placed)
        for index,d,p in placements:
            cm.Add(bu[index]['units'][0]['cells'][d,p] == 1)
        s=cp_model.CpSolver();s.parameters.max_time_in_seconds=5;s.parameters.num_search_workers=8
        status=s.Solve(cm)
        return m,o,s,status,values

    def test_actual_fourth_period_separate_and_teacher_overlap(self):
        m=moving();m['blocks'][0]['blockLen']=1;m['blocks'][0]['hours']=1
        m['blocks'].append(dict(m['blocks'][0],grade='3',block='3A',div='3A1'))
        normalized,o=self.normalized(m)
        values=build(normalized,[],{})
        cm,slot=values[:2]
        cm.Add(slot['2','2A',0][1,4] == 1);cm.Add(slot['3','3A',0][1,4] == 1)
        s=cp_model.CpSolver();self.assertIn(s.Solve(cm),(cp_model.FEASIBLE,cp_model.OPTIMAL))
        cm.Add(slot['2','2A',0][1,4] == 0)
        self.assertEqual(s.Solve(cm),cp_model.INFEASIBLE)
        values=build(normalized,[],{});cm,slot=values[:2]
        cm.Add(slot['2','2A',0][1,3] == 1);cm.Add(slot['3','3A',0][1,3] == 1)
        self.assertEqual(s.Solve(cm),cp_model.INFEASIBLE)

    def test_block_once_per_day_and_forbidden(self):
        m,o=self.normalized(moving())
        values=build(m,[],{}, {'2A':[[1,2]]});cm,slot=values[:2]
        cm.Add(slot['2','2A',0][1,2] == 1)
        s=cp_model.CpSolver();self.assertEqual(s.Solve(cm),cp_model.INFEASIBLE)
        values=build(m,[],{});cm,slot=values[:2]
        cm.Add(slot['2','2A',0][1,2] == 1);cm.Add(slot['2','2A',1][1,5] == 1)
        self.assertEqual(s.Solve(cm),cp_model.INFEASIBLE)

    def test_same_grade_blocks_cannot_overlap(self):
        m=moving();m['blocks'][0].update(blockLen=1,hours=1)
        m['teachers'].append('다른강사');m['gangsa'].append('다른강사')
        m['blocks'].append(dict(m['blocks'][0],block='2B',div='2B1',teacher='다른강사'))
        m,o=self.normalized(m);values=build(m,[],{});cm,slot=values[:2]
        for bc in ('2A','2B'):cm.Add(slot['2',bc,0][1,2] == 1)
        self.assertEqual(cp_model.CpSolver().Solve(cm),cp_model.INFEASIBLE)

    def test_grade3_career_and_lead_exception(self):
        m=full_class('3');m['buja']=['가상강사'];m['bans'][0]['hours']=30
        m['bans'].append(dict(m['bans'][0],subject='진로',hours=1))
        norm,o,s,st,values=self.constrained(m)
        self.assertIn(st,(cp_model.OPTIMAL,cp_model.FEASIBLE))
        self.assertEqual(s.Value(values[5][1]['units'][0]['cells'][4,1]),1)
        _,_,_,st,_=self.constrained(m,[(0,4,1)])
        self.assertEqual(st,cp_model.INFEASIBLE)

    def test_gangsa_day_limit_is_upper_bound(self):
        m=moving();m,o=self.normalized(m,{'gangsaDayCount':{'가상강사':1}})
        result=solve(m,o,(5,0,0));self.assertEqual(result['status'],'INFEASIBLE')
        m=moving();m['blocks'][0].update(blockLen=1,hours=1)
        m,o=self.normalized(m,{'gangsaDayCount':{'가상강사':2}})
        result=solve(m,o,(5,0,0));self.assertEqual(result['status'],'SUCCESS')
        self.assertEqual(len({r['d'] for r in result['SEC_PLACE']}),1)

    def test_art_two_plus_one(self):
        m=full_class();m['bans'][0]['hours']=28
        m['bans'].append(dict(m['bans'][0],hours=3,subject='가상미술',art=True))
        _,_,_,st,_=self.constrained(m,[(1,1,2)])
        self.assertIn(st,(cp_model.OPTIMAL,cp_model.FEASIBLE))
        m,o=self.normalized(m);values=build(m,[],{});cm=values[0];units=values[5][1]['units']
        for u,p in zip(units,(2,3,5)):cm.Add(u['cells'][1,p] == 1)
        self.assertEqual(cp_model.CpSolver().Solve(cm),cp_model.INFEASIBLE)
        values=build(m,[],{});cm=values[0];units=values[5][1]['units']
        for u,(d,p) in zip(units,[(1,4),(1,5),(2,2)]):cm.Add(u['cells'][d,p] == 1)
        self.assertEqual(cp_model.CpSolver().Solve(cm),cp_model.INFEASIBLE)

    def test_normal_rules_and_separated_pair(self):
        m=normal_class();m['bans'][9]['subject']=m['bans'][11]['subject']='가상쌍'
        placements=[(i+1,d,p) for i,(d,p) in enumerate(NORMAL_CELLS)]
        norm,o,s,st,v=self.constrained(m,placements,{'pairAllowList':['가상쌍']})
        self.assertIn(st,(cp_model.OPTIMAL,cp_model.FEASIBLE))
        _,_,_,st,_=self.constrained(m,placements)
        self.assertEqual(st,cp_model.INFEASIBLE)
        m['bans'][9]['subject']='다른과목';m['bans'][10]['subject']='가상쌍'
        _,_,_,st,_=self.constrained(m,placements,{'pairAllowList':['가상쌍']})
        self.assertEqual(st,cp_model.INFEASIBLE)

    def test_dependents(self):
        m=moving();m['blocks'][0].update(blockLen=2,hours=1)
        m['teachers'].append('다른강사');m['gangsa'].append('다른강사')
        m['blocks'].append(dict(m['blocks'][0],subject='종속',div='2A2',teacher='다른강사'))
        m,o=self.normalized(m,{'dependents':[{'subject':'가상선택','follows':['종속']}]})
        values=build(m,[],{},dependents=o['dependents']);cm=values[0];y=values[4]
        cm.Add(y[0,0] == 1);cm.Add(y[1,0] == 1)
        self.assertEqual(cp_model.CpSolver().Solve(cm),cp_model.INFEASIBLE)

    def test_statuses_and_prior_solution_survives(self):
        m,o=self.normalized(moving())
        result=solve(m,o,(0,0,0));self.assertEqual(result['status'],'UNKNOWN')
        class UnknownAfterFirst:
            calls=0
            def __new__(cls):
                cls.calls+=1
                s=cp_model.CpSolver()
                if cls.calls > 1:
                    original=s.Solve
                    def fail(cm):
                        s.parameters.max_time_in_seconds=0
                        return original(cm)
                    s.Solve=fail
                return s
        result=solve(m,o,(5,5,5),solver_factory=UnknownAfterFirst)
        self.assertEqual(result['status'],'SUCCESS');self.assertEqual(result['adoptedStage'],'1')
        self.assertEqual(result['stages'][2]['status'],'UNKNOWN')
        self.assertEqual(len(result['SEC_PLACE']),2)
        with patch('tt_solver.engine.build') as bad:
            original=build(m,[],{});original[0].NewIntVar(2,1,'bad')
            bad.return_value=original
            self.assertEqual(solve(m,o,(5,0,0))['status'],'MODEL_INVALID')

    def test_third_stage_failure_keeps_fair_solution_and_parameters(self):
        m,o=self.normalized(normal_class())
        solvers=[]
        def factory():
            s=cp_model.CpSolver();solvers.append(s)
            if len(solvers) == 3:
                original=s.Solve
                def fail(cm):
                    s.parameters.max_time_in_seconds=0
                    return original(cm)
                s.Solve=fail
            return s
        r=solve(m,o,(5,5,5),solver_factory=factory)
        self.assertEqual(r['adoptedStage'],'2')
        self.assertEqual(r['stages'][3]['status'],'UNKNOWN')
        self.assertEqual([s.parameters.num_search_workers for s in solvers],[16,8,8])
        self.assertEqual(solvers[0].parameters.num_violation_ls,1)
        self.assertEqual([s['adopted'] for s in r['stages']],[False,False,True,False])
        self.assertTrue(check(m,r,o)['ok'])

    def test_general_teacher_lunch_and_four_in_a_row(self):
        m=normal_class()
        placements=[(i+1,0,p) for i,p in enumerate((2,3,4,5))]
        self.assertEqual(self.constrained(m,placements)[3],cp_model.INFEASIBLE)
        m['blocks']=[dict(grade='3',block='3A',blockLen=1,div='3A',subject='가상이동',teacher='가상교사',hours=1)]
        m,o=self.normalized(m)
        v=build(m,[],{});cm,slot=v[:2]
        cm.Add(v[5][1]['units'][0]['cells'][1,4] == 1)
        cm.Add(slot['3','3A',0][1,4] == 1)
        self.assertEqual(cp_model.CpSolver().Solve(cm),cp_model.INFEASIBLE)

    def test_checker_independently_checks_rules_and_score(self):
        m,o=self.normalized(normal_class())
        result=solve(m,o,(5,5,0));self.assertTrue(check(m,result,o)['ok'])
        # Changing the reported options must be checked against the actual placements.
        bad=copy.deepcopy(result);bad['scores']['가상교사']+=1
        self.assertIn('불편 점수 재계산 불일치',check(m,bad,o)['errors'])
        banned=copy.deepcopy(o)
        row=next(r for r in result['BAN_PLACE'] if r['t']=='가상교사')
        bad=copy.deepcopy(result)
        row2=next(r for r in bad['BAN_PLACE'] if r['t']=='가상교사')
        row2['d'],row2['p']=4,1
        banned['buja']=['가상교사']
        self.assertIn('부장 금1',check(m,bad,banned)['errors'])
        no_days=copy.deepcopy(o);no_days['gangsaDayCount']={'가상강사':1}
        self.assertIn('강사 출근일수 상한',check(m,result,no_days)['errors'])

    def test_score_lower_bound_regression(self):
        m=normal_class();m,o=self.normalized(m,{'weights':{'over4':10,'firstlast':0,'lunch':0,'run3':0}})
        result=solve(m,o,(5,5,5))
        self.assertEqual(result['status'],'SUCCESS');self.assertEqual(result['scores']['가상교사'],-100)
        self.assertEqual(result['adoptedStage'],'2.5')
        self.assertTrue(check(m,result,o)['ok'])
        self.assertLessEqual(score_bounds(o['weights'],12)[0],-100)

    def test_checker_rejects_tampering_and_class_overlap(self):
        m,o=self.normalized(full_class());r=solve(m,o,(5,0,0));self.assertTrue(check(m,r,o)['ok'])
        bad=copy.deepcopy(r);bad['BAN_PLACE'][1].update(d=bad['BAN_PLACE'][0]['d'],p=bad['BAN_PLACE'][0]['p'])
        report=check(m,bad,o);self.assertFalse(report['ok']);self.assertIn('교사 실제 시간 중복',report['errors']);self.assertIn('학급 31칸 빈칸/중복',report['errors'])
        bad=copy.deepcopy(r);bad['BAN_PLACE'][0]['rowId']='invented'
        self.assertFalse(check(m,bad,o)['ok'])
        bad=copy.deepcopy(r);bad['scores']={'가상강사':42}
        self.assertFalse(check(m,bad,o)['ok'])

    def test_sparse_block_grid_and_four_excel_sheets(self):
        m=moving();m['blocks'][0].update(blockLen=2,hours=1)
        m,o=self.normalized(m);r=solve(m,o,(5,0,0));r['options']=o;r['checker']=check(m,r,o)
        self.assertEqual(len(r['blockSlots']),2);self.assertEqual(len(r['SEC_PLACE']),1)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'result.xlsx';write_excel(m,r,path)
            wb=openpyxl.load_workbook(path,data_only=True)
            self.assertEqual(wb.sheetnames,['교사별 시간표','이동수업 배치표','이동수업 분반 상세','검증 요약'])
            for slot in r['blockSlots']:
                self.assertIn('2A',wb.worksheets[1].cell(3+slot['p'],2+slot['d']).value)
            self.assertEqual(wb.worksheets[0].cell(6,1).value,'4교시(1·2학년)')
            self.assertEqual(wb.worksheets[0].cell(7,1).value,'4교시(3학년)')
            wb.close()

    def test_xlsx_labels_never_become_formulas(self):
        m=moving();m['teachers']=['=1+1'];m['gangsa']=['=1+1'];m['blocks'][0]['teacher']='=1+1'
        m,o=self.normalized(m);r=solve(m,o,(5,0,0));r['options']=o;r['checker']=check(m,r,o)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'result.xlsx';write_excel(m,r,path)
            wb=openpyxl.load_workbook(path)
            self.assertEqual(wb.worksheets[0]['A1'].value,'=1+1')
            self.assertEqual(wb.worksheets[0]['A1'].data_type,'s');wb.close()

    def test_zero_class_grade_without_rows_is_valid(self):
        m = full_class()
        m['classes'].update({'2': 0, '3': 0})
        self.assertEqual(validate(m)[2], [])

    def test_zero_class_grade_with_rows_is_rejected(self):
        for kind, m in [('bans', full_class()), ('blocks', moving())]:
            with self.subTest(kind=kind):
                m['classes'] = {'1': 0, '2': 0, '3': 0}
                self.assertTrue(validate(m)[2])

    def test_daily_min_relaxation_is_opt_in_and_only_removes_lower_bounds(self):
        m, o = self.normalized(normal_class())
        strict = build(m, [], {})[0]
        explicit = build(m, [], {}, daily_min=True)[0]
        relaxed = build(m, [], {}, daily_min=False)[0]
        self.assertEqual(str(strict.Proto()), str(explicit.Proto()))
        self.assertEqual(len(strict.Proto().constraints)-len(relaxed.Proto().constraints), 5)
        self.assertEqual([(v.name,list(v.domain)) for v in strict.Proto().variables],
                         [(v.name,list(v.domain)) for v in relaxed.Proto().variables])

    def test_relaxed_solution_is_never_adopted_or_extracted(self):
        m, o = self.normalized(moving(), {'startLimit': 5})
        calls = []
        def factory():
            s = cp_model.CpSolver()
            calls.append(s)
            if len(calls) == 2:
                original = s.Solve
                def unknown(cm):
                    s.parameters.max_time_in_seconds = 0
                    return original(cm)
                s.Solve = unknown
            return s
        with patch('tt_solver.engine.extract', wraps=extract) as extraction:
            result = solve(m, o, (5,0,0), solver_factory=factory)
        extraction.assert_not_called()
        self.assertEqual(result['status'], 'UNKNOWN')
        self.assertIsNone(result['adoptedStage'])
        self.assertNotIn('SEC_PLACE', result)
        self.assertFalse(result['stages'][0]['adopted'])
        self.assertEqual(result['stages'][0]['relaxed'], 'daily_min')
        self.assertIn(result['stages'][0]['status'], ('OPTIMAL','FEASIBLE'))

    def test_default_start_limit_skips_relaxed_solver(self):
        m, o, errors = validate(moving())
        self.assertEqual(errors, [])
        self.assertEqual(o['startLimit'], 0)
        calls = []
        def factory():
            s = cp_model.CpSolver(); calls.append(s); return s
        result = solve(m,o,(5,0,0),solver_factory=factory)
        self.assertEqual(len(calls),1)
        self.assertEqual(result['stages'][0]['status'],'SKIPPED')
        self.assertEqual(result['stages'][0]['reason'],'zero_limit')
        self.assertTrue(check(m,result,o)['ok'])

    def test_previous_result_hints_follow_row_ids_after_reordering(self):
        for kind in ('blocks','bans'):
            with self.subTest(kind=kind):
                if kind == 'blocks':
                    source=moving();source['blocks'][0]['hours']=1
                    source['blocks'].append(dict(source['blocks'][0],div='2A2',subject='다른선택'))
                else:
                    source=full_class();source['bans'][0]['hours']=15
                    source['bans'].append(dict(source['bans'][0],hours=16,subject='다른수업'))
                m,o=self.normalized(source)
                previous=solve(m,o,(5,0,0))
                key='SEC_PLACE' if kind == 'blocks' else 'BAN_PLACE'
                previous[key].append(dict(previous[key][0],rowId='obsolete'))
                m[kind].reverse()
                o['startLimit']=300
                def factory():
                    s=cp_model.CpSolver()
                    s.parameters.fix_variables_to_their_hinted_value=True
                    return s
                result=solve(m,o,(5,0,0),solver_factory=factory,warm_start=previous)
                self.assertEqual(result['stages'][0]['reason'],'previous_result')
                self.assertEqual(result['warmStart']['matchedRowIds'],2)
                self.assertEqual(result['warmStart']['ignoredRowIds'],1)
                self.assertAlmostEqual(result['warmStart']['matchRate'],2/3)
                self.assertTrue(check(m,result,o)['ok'])
                actual={(r['rowId'],r['d'],r['p']) for r in result[key]}
                expected={(r['rowId'],r['d'],r['p']) for r in previous[key] if r['rowId']!='obsolete'}
                self.assertEqual(actual,expected)

    def test_relaxed_start_then_strict_solution_passes_checker(self):
        m,o=self.normalized(normal_class(),{'startLimit':5})
        result=solve(m,o,(5,0,0))
        self.assertEqual(result['adoptedStage'],'1')
        self.assertFalse(result['stages'][0]['adopted'])
        self.assertTrue(check(m,result,o)['ok'])

    def test_relaxed_hint_contains_blocks_sections_and_homeroom_cells(self):
        m=full_class('2')
        m['blocks']=moving()['blocks']
        m['bans'][0]['hours']=29
        m,o=self.normalized(m,{'startLimit':5})
        hinted_names=[]
        def factory():
            s=cp_model.CpSolver(); original=s.Solve
            def inspect(cm):
                hinted_names.append([cm.Proto().variables[i].name for i in cm.Proto().solution_hint.vars])
                return original(cm)
            s.Solve=inspect
            return s
        result=solve(m,o,(5,0,0),solver_factory=factory)
        for prefix in ('s2','y','u0_','pp0_'):
            self.assertTrue(any(name.startswith(prefix) for name in hinted_names[1]),prefix)
        self.assertTrue(check(m,result,o)['ok'])

    def test_relaxed_feasible_does_not_change_strict_infeasible_status(self):
        m=normal_class()
        m['bans']=m['bans'][:9]
        m['bans'][0]['hours']=23
        m,o=self.normalized(m,{'startLimit':5})
        result=solve(m,o,(5,0,0))
        self.assertIn(result['stages'][0]['status'],('OPTIMAL','FEASIBLE'))
        self.assertEqual(result['status'],'INFEASIBLE')
        self.assertIsNone(result['adoptedStage'])

    def test_prevalidation_contract(self):
        mutations=[lambda m:m.update(_version=2),lambda m:m.pop('teachers'),lambda m:m['blocks'][0].pop('div'),lambda m:m['blocks'][0].update(hours=1.5),lambda m:m.update(flags=['배치 초과']),lambda m:m['blocks'].append(dict(m['blocks'][0],blockLen=3)),lambda m:m['blocks'].append(dict(m['blocks'][0],teacher='다른교사'))]
        for mutate in mutations:
            m=moving();mutate(m)
            self.assertTrue(validate(m)[2])
        m=full_class();m['bans'][0]['hours']=30;self.assertTrue(validate(m)[2])
        m=moving();m['blocks'].append(dict(m['blocks'][0]));self.assertTrue(validate(m)[2])
        m=moving();m['teachers'].append('다른교사');m['gangsa'].append('다른교사')
        m['blocks'].append(dict(m['blocks'][0],teacher='다른교사'))
        self.assertTrue(any('(div, 과목)' in e for e in validate(m)[2]))
        for key,value in [('teachers',[{}]),('blocks',[{}]),('flags',None),('classes',[]),('buja',3)]:
            m=moving();m[key]=value;self.assertTrue(validate(m)[2])
        self.assertTrue(validate(moving(),limits=None)[2])
        m,o,errors=validate(moving());self.assertEqual(errors,[]);self.assertEqual(m['blocks'][0]['rowId'],'blocks:0')
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(run({}, {}, out, (1,0,0))['status'],'VALIDATION_ERROR')


class ServerTests(unittest.TestCase):
    @unittest.skipUnless(os.name == 'nt', 'Windows file sharing behavior')
    def test_atomic_status_retries_while_a_reader_is_open(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'status.json'
            atomic_json(path,{'state':'old'})
            blocked=threading.Event()
            errors=[]
            replace=os.replace
            def observed_replace(source,target):
                try:
                    return replace(source,target)
                except PermissionError:
                    blocked.set()
                    raise
            def write():
                try:
                    atomic_json(path,{'state':'new'})
                except Exception as error:
                    errors.append(error)
            with patch('tt_solver.runner.os.replace',side_effect=observed_replace):
                with path.open('r',encoding='utf-8'):
                    worker=threading.Thread(target=write)
                    worker.start()
                    self.assertTrue(blocked.wait(3),'reader must overlap the atomic commit')
                worker.join(timeout=3)
                self.assertFalse(worker.is_alive())
            self.assertEqual(errors,[])
            self.assertEqual(read_json(path),{'state':'new'})

    def test_open_reuses_running_server(self):
        with tempfile.TemporaryDirectory() as root:
            server=make_server(0,root)
            thread=threading.Thread(target=server.serve_forever);thread.start()
            try:
                with patch('tt_solver.server.webbrowser.open') as browser:
                    serve(server.server_port,root,True)
                    browser.assert_called_once_with(f'http://127.0.0.1:{server.server_port}')
            finally:
                server.shutdown();thread.join();server.runs.close();server.server_close()

    def test_api_round_trip_origin_host_and_restart(self):
        with tempfile.TemporaryDirectory() as root:
            server=make_server(0,root)
            thread=threading.Thread(target=server.serve_forever);thread.start()
            base=f'http://127.0.0.1:{server.server_port}'
            def post(path,data,headers=None):
                return urlopen(Request(base+path,json.dumps(data).encode(),{'Content-Type':'application/json',**(headers or {})}),timeout=10)
            try:
                with urlopen(base+'/') as response:self.assertIn('시간표 로컬 솔버',response.read().decode())
                with self.assertRaises(HTTPError) as error:post('/api/runs',{}, {'Origin':'http://example.invalid'})
                self.assertEqual(error.exception.code,403)
                with self.assertRaises(HTTPError) as error:urlopen(Request(base+'/api/runs',headers={'Host':'attacker.invalid'}))
                self.assertEqual(error.exception.code,403)
                with post('/api/runs',{'model':moving(),'options':{},'limits':[5,0,0]}) as response:rid=json.load(response)['id'];self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))
                with self.assertRaises(HTTPError) as error:post('/api/runs',{'model':moving(),'options':{},'limits':[5,0,0]})
                self.assertEqual(error.exception.code,409)
                deadline=time.monotonic()+30
                while True:
                    with urlopen(base+'/api/runs/'+rid) as response:status=json.load(response)
                    if status['state'] != '실행 중':break
                    self.assertLess(time.monotonic(),deadline);time.sleep(.1)
                self.assertEqual(status['state'],'SUCCESS',status)
                self.assertEqual(status['result']['options']['startLimit'],0)
                self.assertEqual(status['result']['stages'][0]['reason'],'zero_limit')
                with urlopen(base+f'/api/runs/{rid}/result.xlsx') as response:
                    wb=openpyxl.load_workbook(io.BytesIO(response.read()));self.assertEqual(len(wb.sheetnames),4);wb.close()
                with urlopen(base+'/api/runs') as response:self.assertEqual(len(json.load(response)),1)
                with post('/api/runs',{'model':moving(),'options':{},'limits':[5,0,0],'warmStart':status['result']}) as response:warm_id=json.load(response)['id']
                deadline=time.monotonic()+30
                while True:
                    with urlopen(base+'/api/runs/'+warm_id) as response:warmed=json.load(response)
                    if warmed['state'] != '실행 중':break
                    self.assertLess(time.monotonic(),deadline);time.sleep(.1)
                self.assertEqual(warmed['state'],'SUCCESS',(Path(root)/warm_id/'log.txt').read_text(encoding='utf-8'))
                self.assertEqual(warmed['result']['stages'][0]['reason'],'previous_result')
                self.assertEqual(warmed['result']['warmStart']['matchRate'],1)
                self.assertTrue(warmed['result']['checker']['ok'])
                with post('/api/runs',{'model':moving(),'options':{},'limits':[1800,600,120]}) as response:rid2=json.load(response)['id']
                with post(f'/api/runs/{rid2}/cancel',{}) as response:self.assertIn(json.load(response)['state'],('취소됨','SUCCESS'))
            finally:
                server.shutdown();thread.join();server.runs.close();server.server_close()
            stale=Path(root)/'stale';stale.mkdir();atomic_json(stale/'status.json',{'state':'실행 중','pid':2147483647})
            Runs(root).list()
            self.assertEqual(read_json(stale/'status.json')['state'],'중단됨')


if __name__ == '__main__':
    unittest.main()
