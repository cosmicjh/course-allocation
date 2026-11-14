# Windows 로컬 시간표 솔버

학교 PC의 Windows 10/11 x64에서 실행합니다. 시간표 자료는 PC 안에서 계산하고 `127.0.0.1`에서만 화면을 제공합니다.

## 최초 설치 · 인터넷 1회 필요

1. 이 저장소를 쓰기 가능한 폴더에 준비합니다. `timetable-solver\setup.cmd`를 두 번 클릭합니다.
2. 공식 Python 3.13.11 embeddable x64와 pip 26.3을 SHA-256 검증 후 `runtime/`에 설치합니다. OR-Tools 9.15.6755, openpyxl 3.1.5와 모든 의존성은 `requirements.txt`의 정확한 버전·휠 해시로 설치합니다. 관리자 권한이나 PowerShell 실행 정책 변경이 필요 없습니다.
3. `Setup complete`가 나오면 바탕화면의 **Timetable Solver** 바로가기를 엽니다. 이미 설치한 경우 `setup.cmd`는 설치를 건너뛰고 바로가기를 다시 만듭니다.

설치 출처: [Python 공식 배포](https://www.python.org/ftp/python/3.13.11/), [OR-Tools PyPI](https://pypi.org/project/ortools/9.15.6755/), [openpyxl PyPI](https://pypi.org/project/openpyxl/3.1.5/). Python ZIP SHA-256: `1ec066fb61ba5e8c73e29e048cd07c26850f74585e3a116005135b31b8004890`. pip 휠 SHA-256: `f3b60b20ffaadd4415ed7957212a38ac63fa4c5fa375bd0f4a797777940fad13`.

서비스, 예약 작업, 시작 프로그램, 자동 실행 훅을 등록하지 않습니다. 화면 글꼴은 Pretendard이며 인터넷이 없으면 시스템 글꼴로 표시됩니다.

## 실행

바로가기 또는 `start.cmd`를 엽니다. 서버가 이미 응답하면 화면만 열고, 아니면 콘솔에서 서버를 실행합니다. 브라우저 주소는 `http://127.0.0.1:8765`입니다. **콘솔 창을 닫으면 서버와 계산도 종료**합니다. 브라우저만 닫으면 계산은 계속되며 화면을 다시 열어 결과를 확인할 수 있습니다.

1. 교과시수배당 시스템에서 내보낸 `시간표_솔버모델` v1 JSON을 선택합니다.
2. 필요하면 이전 `고교학점제_설정` JSON을 불러옵니다. `timetable.bujaList`, `pairAllow`, 문자열 가중치, 출근일수를 변환합니다. 0일 설정은 제한 없음으로 처리합니다. 분반 배정 설정 `bunban`은 솔버 옵션이 아닙니다.
3. 부장·강사 목록, 가중치와 기타 옵션을 확인하고 계산을 시작합니다. 필요하면 이전 실행을 고르거나 `result.json`을 올려 시작점으로 사용합니다. 계산은 한 번에 하나이며 취소할 수 있습니다. 편집 중인 옵션은 브라우저에 보관하고 비동기 불러오기가 진행 중인 입력을 덮어쓰지 않습니다.
4. 실행 기록에서 결과, 채택 단계, 독립 검사기 결과와 교사별 배치 요약을 확인하고 엑셀을 다운로드합니다.

강사 출근일수는 **상한**, 하루 2회 허용은 **표시 교시 차이 3 이상**입니다. 원본 HTML의 `artBlock`, `noLunchBlock`, `spread`, `coverage`, `coverageSubjects`, `bujaFridayP1Forbidden` 설정은 미적용입니다. 고정 규칙과 강사 예외는 화면의 적용 여부 표에 있습니다. 미술 그룹은 원본과 같이 인접쌍 1개를 요구하며 4→5교시는 연강쌍에서 제외합니다.

## 탐색과 결과 위치

기본 탐색은 0단계 0초(생략), 1단계 배치 최대화 1,800초·16워커·`num_violation_ls=1`, 2단계 최고 불편 최소화 600초·8워커, 2.5단계 같은 형평에서 총 불편 최소화 120초·8워커입니다. 두 후속 단계 모두 1단계 블록·섹션 힌트를 사용합니다. 고정 OR-Tools 버전에서 파라미터 이름 변경은 없었습니다. 후속 단계가 실패하면 직전 유효 해를 보존하며 0초인 0·2·2.5단계는 생략합니다. 기본 탐색 예산은 총 42분이며 이전 결과를 고르면 0단계를 생략합니다.

유효한 이전 결과를 시작점으로 쓰면 가장 빠릅니다(권장). 0단계 완화 탐색은 실험적 선택 기능이며, 시간을 입력하면 16워커로 실행합니다. 이전 결과가 없는 첫 계산은 1단계 제한 시간을 늘려야 할 수 있습니다.

**시작점 탐색은 학교 규칙은 바꾸지 않는 탐색 보조입니다.** 0단계에서만 일반교사 하루 최소 2시간 제약을 빼고 배치 최대화를 풉니다. 얻은 블록 슬롯·섹션·반수업 칸을 원래 제약이 모두 있는 1단계에 soft hint로 전달하며, 0단계 배치는 출력하거나 채택하지 않습니다. 이전 결과는 `rowId`로 현재 배당에 대응하고 미대응 ID를 무시하며, 결과의 `warmStart`에 대응 수·비율을 기록합니다. 이전 결과도 유효한 해라고 가정하지 않습니다. 최종 배치는 같은 독립 검사기를 통과해야 하며 1단계 `INFEASIBLE`은 불가능 증명, `UNKNOWN`은 제한 시간 내 판정 미완료라는 의미를 유지합니다.

OR-Tools 9.15.6755의 `repair_hint`, `hint_conflict_limit` 지원을 확인했으나 개선 효과를 입증하지 않아 기본값을 유지합니다([공식 파라미터 설명](https://github.com/google/or-tools/blob/v9.15/ortools/sat/sat_parameters.proto)). 힌트 값을 제약으로 고정하는 파라미터는 사용하지 않습니다.

`runs/<실행 ID>/`에 원본 `model.json`, 실행 `options.json`, 원자적으로 저장하는 `status.json`, `log.txt`, `result.json`, `result.xlsx`가 남습니다. 모델 해시는 UTF-8 JSON 키 정렬·공백 제거 후 SHA-256입니다. 결과에는 적용 옵션, 배당 `rowId`(옛 모델은 `blocks:<행 순번>`/`bans:<행 순번>`, 0부터), 블록 슬롯과 단계별 기록을 포함합니다. 파일에는 교사 정보가 있으므로 학교 업무 자료와 같은 기준으로 보관하세요. 이 폴더와 `runtime/`은 Git에서 제외합니다.

상태는 `VALIDATION_ERROR`(사전 검증 오류), `MODEL_INVALID`, `INFEASIBLE`(불가능 증명), `UNKNOWN`(시간 내 판정 미완료), `SUCCESS`와 실제 채택 단계로 구분합니다. 독립 검사기가 실패한 결과는 **검증 실패**로 표시하고 엑셀 검증 요약에도 원인을 넣습니다. 재시작 시 PID가 사라진 실행은 **중단됨**, 사용자가 취소한 실행은 **취소됨**입니다.

엑셀은 원본 노트북과 같은 **교사별 시간표**(실제 시간 8행), **이동수업 배치표**(표시 교시 7행), **이동수업 분반 상세**, **검증 요약** 4개 시트입니다. 점수 범위를 가중치·시수로 계산하는 수정과 수업이 없는 슬롯도 블록 배치표에 보존하는 수정이 원본과의 의도적 차이입니다.

## CLI와 검증

저장소 루트에서 실행합니다. CLI와 서버 작업 프로세스는 같은 `runner.run` 코드를 사용합니다.

```bat
timetable-solver\runtime\python.exe -m tt_solver run --model model.json --out timetable-solver\runs\manual --options options.json --limits 1800,600,120
timetable-solver\runtime\python.exe -m tt_solver run --model model.json --out timetable-solver\runs\from-previous --warm-start previous-result.json --limits 1800,600,120
timetable-solver\runtime\python.exe -m unittest discover -s timetable-solver\tests -v
timetable-solver\runtime\python.exe timetable-solver\tools\xlsx_rows.py input.xlsx > rows.json
```

`--options`, `--limits`, `--start-limit`, `--warm-start`는 생략할 수 있습니다. `--limits`는 기존 1·2·2.5단계의 3개 값이며, 0단계는 `--start-limit` 또는 옵션 JSON의 `startLimit`으로 정합니다(기본 0초: 생략). 이전 결과를 지정하면 `warm-start.json`으로 해당 실행에 보관합니다. CLI 종료 코드는 성공 0, 입력 오류·불가능·미판정·검증 실패 1입니다. `xlsx_rows.py`는 캐시된 셀 값만 읽으며 수식을 계산하지 않습니다. 테스트에는 합성 자료만 사용하며 API 서버 실제 기동, 계산·조회·엑셀 다운로드, 취소와 교차 Origin 거부도 포함합니다.

## 문제 해결과 오프라인 PC

- 설치 실패: 앞서 표시된 다운로드·해시·디스크 오류를 확인합니다. python.org, files.pythonhosted.org, pypi.org 연결을 확인한 뒤 다시 `setup.cmd`를 실행합니다. 해시 실패 파일은 실행하지 않습니다.
- 모델 오류: `div` 누락은 옛 모델입니다. 원본 배당에서 새 모델을 내보냅니다. 시수·블록 길이·학급 합 오류는 배당 자료를 수정한 뒤 다시 내보냅니다.
- `INFEASIBLE`: 제한 시간을 늘려도 불가능 증명은 바뀌지 않습니다. 배당과 고정 규칙을 대조합니다. `UNKNOWN`은 제한 시간을 늘려 재시도할 수 있습니다.
- 창이 열리지 않음: `start.cmd` 콘솔 오류와 8765 포트 사용 여부를 확인합니다. 외부 접속이나 다른 Host를 사용하지 않습니다. 상세 계산 오류는 해당 실행의 `log.txt`에 있습니다.
- 강제 종료 후 기록은 남습니다. 진행 중 자료는 중단됨으로 표시되며 결과가 없는 실행은 새로 시작합니다.
- **오프라인 대안**: 인터넷이 되는 Windows x64 PC에서 `setup.cmd`를 끝낸 뒤 `timetable-solver/` 전체(설치된 `runtime/` 포함, 업무 자료가 있는 `runs/` 제외)를 USB 등 승인된 매체로 옮깁니다. 대상 PC에서 `setup.cmd`를 실행하면 네트워크 설치를 건너뛰고 그 PC의 바로가기를 만듭니다. 런타임만 옮기거나 다른 Python 버전·아키텍처의 휠을 섞지 마세요.
