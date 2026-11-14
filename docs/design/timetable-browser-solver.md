# 브라우저 시간표 계산 (설치 없이 통합시간표에서 계산)

Status: 설계 승인 (2026-11-14). 선행 설계: `docs/design/timetable-solver.md`.

## Context

1차에서는 확정 배당을 솔버 JSON으로 내보내고, 학교 PC에 설치한 로컬 Python 솔버로 계산했다. 사용자는 다운로드·설치 없이 브라우저 안에서 계산하는 방안을 요청했다.
성능 시험(`.cache/timetable-verify/wasm-spike/REPORT.md`) 결과는 다음과 같다.
- or-tools-wasm 1.0.0(Apache-2.0, CP-SAT 9.15, 지금 엔진과 같은 버전)을 Edge에서 실행했다.
- 2학기 실데이터는 이전 결과를 시작점으로 쓰면 **6.2초**에 OPTIMAL이었다.
- 형평 단계는 8워커 600초에 유효해를 찾았다(최고 불편 -1). 11개 해가 모두 독립 검사기를 통과했다.
- 제약: COOP/COEP 헤더가 없으면 1워커도 동작하지 않는다. 형평 8워커는 메모리를 약 1.8GB 쓴다. 처음부터 계산은 Node 8워커로 25.8분이 걸렸다.

**목표**: 통합시간표 관리자 → 시간표 탭 → "브라우저에서 계산" → Worker 도메인 계산 페이지(관리자 로그인) → 확정 배당 자동 읽기 → 시작점 선택 → 계산 → 검사 → 결과 표·엑셀.
로컬 솔버는 처음부터 계산하는 대안으로 유지한다.

**사용자 결정 (2026-11-14)**
- 계산 페이지에서 관리자 로그인을 한다. 쿠키 방식이고, Worker 도메인에서 이미 로그인했다면 그대로 쓴다.
- 엑셀은 기존 SheetJS로 만들고, 내용·행·열 너비만 로컬 솔버와 같게 한다. 색·테두리는 빠진다.
- 실행 범위는 시험 통과 후 커밋, 두 저장소 push, 운영 Worker 배포까지다. 이 계획 승인에 포함된다.

## 구조와 데이터 흐름

```
GitHub Pages 관리자 '시간표' 탭 ── 새 탭 ──> https://school-timetable.cosmicjh.workers.dev/solver.html
                                              (COOP: same-origin, COEP: require-corp — 이 경로만)
 관리자 로그인(기존 Auth.login, 쿠키) → courseWorkspace API(기존, 읽기 전용)
 → exportSolverModel(기존) → buildCpModel(JS, 신규) → or-tools-wasm Worker에서 solve
 → 단계 0(선택)/1/2/2.5 (엔진과 같은 순서·유효해 보존) → 결과 행 추출
 → 독립 검사기(JS, 신규) → 화면 표 · SheetJS 엑셀 · result.json 내려받기 · IndexedDB 보관
```

- 모델과 결과는 브라우저 밖으로 나가지 않는다. 읽기는 기존 API만 쓰고, 새 API·D1 쓰기·마이그레이션은 없다.
- 헤더는 `/solver.html`과 그 자산 경로에만 건다. 기존 관리자 화면과 iframe에는 영향이 없다.

## 구성 요소

### 1. 공유 모듈 (원본은 `course-allocation/shared/`, 통합시간표 vendor로 복사)
- `shared/timetable-cpsat.js`(신규): Python `timetable-solver/tt_solver/engine.py`의 `build`, `teacher_occupancy`, `discomfort_terms`, `_step_cost`, 단계 실행 순서, 힌트 적용(`hints.py`), 결과 추출을 JS로 옮긴다.
  - or-tools-wasm의 `CpModel` API(또는 proto 직접 생성)를 쓴다.
  - 옵션 의미와 기본값(0단계 0초, 1800/600/120초, 승인된 의도적 차이 두 가지)을 Python과 같게 한다.
- `shared/timetable-checker.js`(신규): `tt_solver/checker.py`를 옮긴다. 엔진 모듈을 import하지 않는다. 후속 서버 재검증에서도 그대로 쓸 수 있게 순수 함수로 만든다.
- 기존 `shared/timetable-model.js`는 그대로 재사용한다.

### 2. 통합시간표 (`timetable-cloudflare`)
- `solver.html` + `assets/solver/*`(신규): 계산 전용 페이지.
  - 기존 로그인 화면·스타일(모노톤, Pretendard 자체 호스팅)을 재사용한다.
  - 화면 구성: 점검 결과, 시작점(IndexedDB 이전 결과 / result.json 올리기 / 없음), 단계별 시간·워커 수, 진행·취소, 결과 요약(교사별 표), 엑셀·result.json 내려받기.
- or-tools-wasm@1.0.0을 정확한 버전으로 고정한다. CP-SAT 자산(JSPI, 필요 시 Asyncify)만 `dist`에 복사하고 Apache-2.0 고지를 함께 둔다. Worker 번들에는 넣지 않는다(기존 번들 검사 확장).
- `scripts/build.mjs`의 `_headers` 생성에 `/solver.html`과 계산 자산 경로용 COOP/COEP 블록을 추가한다. 기존 `/*` 규칙은 유지한다.
- **워커 수 기본값**: `min(8, 논리 코어)`. `navigator.deviceMemory`가 8 미만이면 4로 낮춘다. 사용자가 바꿀 수 있다.
- **장시간 실행 대비**: 계산 중 Screen Wake Lock을 요청하고, 탭을 열어 두라는 안내를 한 줄 표시한다. 진행 이벤트가 늦게 오는 문제에 대비해 단계 경과 시간을 화면이 직접 센다.
- 시간표 탭(`assets/app.js` `renderSolver`)에 "브라우저에서 계산" 링크를 추가한다(Worker 도메인 새 탭). 로컬 솔버 안내는 처음부터 계산하는 대안으로 줄여 남긴다.
- `vendor/course-allocation/shared/`에 새 공유 모듈 2개를 복사하고, 상단에 원본 경로 주석을 단다.

### 3. 시수배당 (`course-allocation`)
- `shared/timetable-cpsat.js`, `shared/timetable-checker.js`와 시험을 추가한다.
- or-tools-wasm은 devDependency로 고정해 Node 시험에서만 쓴다. 화면 번들에는 넣지 않는다.

## 정확성 보장 (핵심 시험)
1. **모델 동일성**: 가상 모델 여러 개(작은 학급, 블록·세부분반, 미술, 종속 과목, 강사·부장, 하루 2회 분리, 블록 금지 칸)에 대해 Python 엔진이 만든 CpModelProto와 JS 빌더가 만든 proto를 비교한다.
   - 비교 대상: 변수·정의역, 제약, 목적함수, 힌트
   - 1순위는 바이트 동일, 안 되면 정규화한 구조 동일
   - Python 출력은 가상 자료로 만든 기준 fixture로 커밋해 CI의 Node 시험이 비교한다.
   - 실데이터 E는 `.cache`에서만 비교한다.
2. **검사기 동일성**: 같은 결과(정상·위반 사례)에 대해 JS 검사기와 Python 검사기의 판정·점수가 같다.
3. **WASM 종단**: Node에서 가상 소형 모델을 or-tools-wasm으로 풀어 검사기 통과를 확인한다(CI). 브라우저 시험(Playwright Edge, COOP/COEP 적용 로컬 Worker)에서는 로그인 → 읽기 → 계산 → 새로고침 후 IndexedDB 시작점 → 엑셀 내려받기까지 확인한다.
4. **실데이터(.cache)**: 브라우저 페이지에서 2학기 자료와 이전 결과 시작점으로 1단계 OPTIMAL을 확인하고, 형평 단계 결과의 검사기 통과와 엑셀 4시트·행 수를 확인한다. 교사명은 보고하지 않는다.
5. **회귀**
   - course-allocation: `pnpm test` 등 기존 전체
   - timetable-cloudflare: `pnpm test:all`, `pnpm build`·`build:pages`
   - Worker 번들 제외 검사
   - `/solver.html` 외 경로에 COOP/COEP가 없는지 확인

## 작업 분할 (Orca, Codex)

| Task | 범위 | 의존 |
| --- | --- | --- |
| H 공유 모듈 | course-allocation `shared/timetable-cpsat.js`, `shared/timetable-checker.js`, 기준 fixture 생성 스크립트·시험, `package.json` devDependency | — |
| I 계산 페이지 | timetable-cloudflare `solver.html`, `assets/solver/*`, 빌드·헤더, 시간표 탭 링크, vendor 복사, 브라우저 시험 | H |
| J 실데이터 종단 | 코드 수정 없음, `.cache`에서 4번 수행 | I |
| K 독립 검토 | 새 Codex 워커, 읽기 전용(Python 대비 동일성·보안 헤더·인증·개인정보) | J |

이후 조정자가 검토·커밋하고 두 저장소를 push한 뒤 `pnpm deploy`로 운영 Worker를 배포하고 운영 응답을 점검한다.

## 위험과 대응
- **유지보수자 1인 라이브러리**: 버전을 고정하고 자산을 저장소에 복사해 둔다. 장애 시 로컬 솔버가 대안이다.
- **메모리**: 워커 기본값을 낮추고, 오류 시 "워커 수를 줄여 다시 실행" 안내를 표시한다.
- **처음부터 계산**: 브라우저에서는 느리다(Node 8워커 25.8분). "시작점 없음"을 고르면 예상 시간을 경고하고 로컬 솔버를 안내한다.
- **vendor 수동 동기화**: 원본과 사본의 SHA-256을 비교하는 검사 스크립트를 course-allocation `scripts/timetable/`에 둔다.
- **설계 문서 갱신**: 승인 후 `docs/design/timetable-solver.md`에 "브라우저 계산" 절을 추가한다(Claude).

## 남는 결정 (이번 범위 밖)
- 결과를 서버(D1)에 저장·채택해 통합시간표 시간표 자료로 등록하는 절차(기존 curriculum 설계의 후속 단계)

Approval record: 2026-11-14 사용자가 계산 페이지 관리자 로그인, SheetJS 내용 동일 엑셀, 시험 통과 후 커밋·push·운영 배포를 포함해 이 설계를 승인함.
