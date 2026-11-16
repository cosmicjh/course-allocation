# Design: 모듈 UI 통일과 시스템 최적화

Status: Approved by user (2026-11-16)

## Objective and scope

1. 시수배당(`course-allocation`)·로컬 솔버(`timetable-solver/web`)·통합시간표(`timetable-cloudflare`)의 모든 모듈 화면을
   미니멀·모노톤·Pretendard·텍스트 버튼 규칙으로 통일한다.
2. 클라이언트와 서버 API를 측정 기반으로 최적화하고 구조를 정리한다.

통합시간표 모듈: 학생 시간표, 개인시간표, 교과 명렬표, 이동수업 배치표, 결보강(class-swap), 학급별 시간표 인쇄,
시수배당표(vendor), 분반배정(section-assignment), 학생, 시간표, 설정, 스터디룸, 브라우저 솔버(`solver.html`).
`class-swap-cloudflare`, `studyroom_codex_handoff`는 범위 밖이다.

## Current system and constraints

- 스타일이 모듈마다 분산돼 있다: `assets/style.css`, `assets/studyroom.css`, `assets/section-assignment/style.css`,
  `assets/solver/style.css`, `assets/class-swap/view.html` 인라인, 시수배당 `index.html` 인라인(33KB),
  `timetable-solver/web/style.css`.
- 시수배당 CSS는 이전 청록 테마(`--primary:#087f76`, `#273c4b`, `#f2f6fa` 등) 위에 모노톤 규칙을 덧씌운 이중 구조이고
  사용하지 않는 규칙(`.nav`, `.tabs` 등)이 남아 있다.
- 버튼이 채운 검정·채운 회색·테두리 상자·아이콘+텍스트·텍스트로 섞여 있다. 솔버 단계 번호와 카드도 상자다.
- 서버는 2026-11-04 최적화로 대부분 p50 10~20ms(통합시간표), 8~14ms(시수배당)다.
- 남은 비용: 통합시간표 첫 방문 Pretendard 2,057,688B 전송, 시수배당 141KB 단일 HTML과 공유 모듈 8개 순차
  `await import()`, 편집마다 `JSON.parse(JSON.stringify(state))` 전체 복제·`assertState` 전체 검증·`innerHTML` 전체 재렌더.
- `tests/domain.test.mjs`의 원본 CSS SHA-256 시험은 검증 계약 항목이다. 사용자가 새 기준으로 교체하는 것을 승인했다.

## Data structure and flow

- 디자인 원본: `course-allocation/shared/ui.css`(토큰 + 기본 요소). 통합시간표는 이를
  `vendor/course-allocation/shared/ui.css`로 복사(상단에 원본 경로 주석)해 모든 페이지가 모듈 CSS보다 먼저 불러온다.
  로컬 솔버도 같은 파일을 쓴다(제공 방식은 구현자가 결정, 단일 원본 유지).
- 시수배당 배포물: `index.html` + 해시 파일명의 번들 JS/CSS. 통합시간표 vendor는 소스가 아니라 이 빌드 산출물을 복사한다.
- 자료 형식, 백업 schemaVersion=1, ID, API 요청·응답 형식, D1 스키마는 변경하지 않는다.

## Selected approach and rationale

### 1. 공통 디자인 규칙

- 색: 회색조만 사용한다. 기준 토큰: 잉크 `#1f1f1f`, 보조 `#595959`, 비활성 `#767676`, 선 `#e0e0e0`/`#c8c8c8`,
  배경 `#fff`/`#f5f5f5`. 본문 대비는 WCAG AA 이상이다. 오류·경고는 색이 아니라 굵기와 문구로 구분한다.
- 글꼴: Pretendard Variable(통합시간표는 기존 자체 호스팅 서브셋 우선). 최소 12px. 배치표 등 밀도가 필요한 표만 예외.
- 버튼: 테두리·배경을 제거하고 텍스트로 표시한다.
  - 주요 동작(저장·제출·계산 시작·대화상자 확인): 굵은 잉크색 + 밑줄.
  - 보조 동작: 보조 회색, hover 시 잉크색 + 밑줄.
  - 비활성: 비활성 회색, 밑줄 없음. 위험 동작(초기화·삭제)은 기존 확인 절차로 구분한다.
  - `:focus-visible` 윤곽선을 유지한다. 클릭 영역은 데스크톱 32px, 모바일(≤640px) 44px 이상.
- 상자 제거: 카드·패널 테두리는 구획 상단 선으로, 솔버 단계 번호 상자와 파일 선택 버튼은 텍스트로 바꾼다.
- 유지: 사이드바 메뉴의 회색 활성 배경(사용자 결정), 입력칸 테두리, 표 셀 클릭 영역, 탭의 활성 밑줄, 인쇄 양식(글꼴만 맞춤).
- 기존 DOM 클래스·`data-*` 속성·접근성 이름을 가능한 한 유지해 기존 시험과 조작 흐름을 보존한다.

### 2. 최적화

- 시수배당 구조: `index.html`의 CSS·런타임 스크립트를 소스 파일로 분리하고 esbuild로 번들·압축한다.
  순차 import 대기를 없애고 정리 단계에서는 동작을 바꾸지 않는다.
- 시수배당 편집 경로: 대규모 가상 자료(`tests/fixtures/scale.js` 규모)로 입력→화면 반영 시간을 먼저 측정하고,
  전체 복제·전체 검증·전체 재렌더 중 측정된 상위 병목만 줄인다. 서버 전체 재검증은 유지한다.
- 서버: 시수배당 `server/api.js`의 라우팅 구조를 정리한다. 통합시간표는 남은 무거운 경로
  (관리자 초기 자료 약 9천 행 읽기, 배치표 저장)를 재측정해 효과가 확인된 변경만 채택한다.
  버전·충돌·재시도·작업 ID·인증 보호를 유지한다.
- 글꼴: 통합시간표 전체 Pretendard `@font-face`에 서브셋 외 범위의 `unicode-range`를 지정해
  서브셋에 없는 글자가 있을 때만 받게 한다.

### 3. 작업 순서 (같은 파일 동시 수정 금지)

- A (course-allocation): 구조 분리·번들 → `shared/ui.css`·시수배당 UI → 로컬 솔버 화면.
- B (timetable-cloudflare, A와 병렬): 공통 규칙 적용(토큰은 A의 `shared/ui.css` 초안을 기준으로 하고 최종 vendor 동기화는 마지막),
  모듈 CSS 정리, 글꼴.
- C (A 이후, course-allocation): 편집 경로·`server/api.js` 최적화.
- D (B 이후, timetable-cloudflare): 서버 경로 최적화.
- 마지막: 시수배당 빌드 산출물과 `shared/ui.css`를 통합시간표 vendor에 반영하고 양쪽 전체 시험 실행.
- C·D와 인증·학생 자료 경로 변경은 새 Codex 스레드에서 독립 검토한다.

## Rejected alternatives

- 저장 버튼 하나만 상자 유지: 사용자가 전부 텍스트를 선택했다.
- CSS 해시 시험 제거: 의도치 않은 CSS 변경을 잡지 못한다. 새 기준값으로 교체한다.
- 모듈마다 토큰 복사본 유지: 다시 어긋난다. 단일 원본 + vendor 복사를 택했다.
- 성능 측정 없이 일괄 리팩터링: 효과가 확인된 변경만 채택한다.

## Compatibility, privacy and migration risks

- 번들 전환 시 GitHub Pages 하위 경로·Cloudflare 경로·통합시간표 vendor 경로가 모두 동작해야 한다.
- 텍스트 버튼은 클릭 영역이 작아질 수 있다: 최소 크기 시험으로 확인한다.
- 서버 변경은 인증·학생 자료·동시 수정 보호를 건드릴 수 있어 고위험이다. 마이그레이션은 하지 않는다.
- 시험·측정은 가상 자료와 로컬 DB만 사용한다. push·배포는 별도 사용자 승인 후 수행한다.
- 통합시간표의 추적되지 않은 `apps-script-bridge/README.md`는 보존한다.

## Testable acceptance conditions

- course-allocation: `pnpm test:all`, `timetable-solver` Python 단위 시험 통과.
  timetable-cloudflare: `pnpm test:all` 통과.
- 새 시험: 각 화면에서 보이는 `<button>`의 테두리·배경이 투명(명시적 허용 목록 제외), CSS 색 회색조,
  글꼴 스택 첫 항목이 Pretendard 계열, 모바일 390px 가로 넘침 없음, 모바일 클릭 영역 44px 이상.
- CSS 해시 기준값을 새 CSS로 교체하고 `docs/VALIDATION.md`를 갱신한다.
- 성능: 변경 전후 같은 가상 자료·스크립트로 측정해 보고한다.
  서버 p50/p95와 D1 읽기·쓰기 행 수 악화 없음(측정 오차 10% 이내),
  시수배당 첫 로드의 JS/CSS 요청 수·전송량 감소, 대규모 편집 p95 감소,
  통합시간표 첫 방문 글꼴 전송량 감소와 FCP 악화 없음.
- 백업 schemaVersion·ID·API 응답 형식 불변(기존 시험).
- 각 저장소 기능 브랜치에 커밋까지. push·배포는 별도 승인.

## Open questions for user approval

없음. (사이드바 활성 배경 유지 결정 반영)
