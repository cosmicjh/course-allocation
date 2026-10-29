# 구현 구조

## 요청 경계

Pages가 dist/의 정적 파일을 제공합니다. 브라우저는 같은 출처의 /api/*만 호출합니다.
Functions는 DB 바인딩으로 D1에 접근합니다. iframe, 외부 RPC, Google API,
스프레드시트 SDK, 브라우저에 노출되는 DB 자격 증명은 사용하지 않습니다.

index.html의 스타일과 UI 처리, 과목 목록, JSON 변환, SVG 인쇄 코드를 보존했습니다.
C/S/R/P/H/Reset 모듈은 shared/로 추출했습니다. 서버의 상태 검증도 동일한 domain.js를 사용합니다.
화면에서 검증을 통과했더라도 서버에서 다시 검사합니다.

## 데이터와 저장

- workspace: 학교·학년도·학기·학급 수, 사용자 과목 목록, 출처, 교과군 순서와 전역 버전.
- sheets: 교과군 JSON과 교과군별 버전. slots, legacy, unmapped, 교사 과목 행과 importRef를 보존.
- entity_ids: 교과군을 가로지르는 교사/과목/분반/미연결 자료 ID 중복을 SQL 제약으로 차단. 변경된 ID만 쓰기.
- operations: 요청 ID, 요청 해시, 처리 결과. 7일 보존 후 명시적 쓰기 때 최대 100개씩 정리.
- credentials/sessions/login_limits: 암호 검증값, 인증 버전, 만료 세션, IP별 시도 제한.
- write_guards: 전역 변경/인증 변경 트랜잭션의 버전 검사. 정상 처리 후 행이 남지 않음.

백업의 schemaVersion=1 형식을 유지합니다. history는 기존과 같이 클라이언트의 최근
200개 작업 기록이며 서버 감사 기록이나 개인별 편집자 식별을 보장하지 않습니다.
공용 비밀번호 방식이므로 개인별 계정/교과군 소유 권한은 이번 버전의 범위가 아닙니다.

교과군 저장은 revision과 globalRevision이 모두 일치할 때만 SQL UPDATE합니다.
AFTER UPDATE 트리거가 작업 결과를 같은 트랜잭션에 기록합니다. 같은 작업 ID의 같은
요청은 같은 결과를 반환하고, 다른 요청의 ID 재사용은 409로 거부합니다.
클라이언트는 응답 유실/시간 초과 후에도 같은 자료의 작업 ID를 유지합니다.

전역 저장은 버전 가드 → 전역 설정 → 신규 교과군 → 제외 교과군 정리 → 작업 결과를
D1 batch 트랜잭션으로 실행합니다. 가드는 전역 버전뿐 아니라 검증에 사용한 모든
교과군 버전도 검사합니다. 가드 실패는 SQL 오류를 발생시켜 전체를 롤백합니다.
다른 교과군 저장끼리는 서로의 버전 때문에 충돌하지 않습니다.

서버는 ID 집합의 SHA-256을 계산해 sheets.identity_hash에 함께 저장합니다. 이름·시수·순서만
바뀌면 ID 색인을 다시 읽지 않습니다. ID 추가/삭제 때만 SQL 트리거가 색인을 갱신합니다.
자료 변경은 이 API 또는 같은 identity_hash 규칙을 지키는 도구로 수행해야 합니다.

학교 설정과 현재 교과군 저장은 기존 UI와 같이 별도 요청입니다. 전역 저장 성공 후
교과군 저장만 실패할 수 있으며, 미저장 교과군 내용은 화면에 남습니다. 전체 교과군
초기화/복원도 각 교과군 저장 버튼으로 반영하는 기존 동작을 유지합니다.

## 인증과 무료 CPU 예산

PBKDF2-SHA-256 100,000회 계산은 브라우저 Web Crypto에서 수행합니다.
서버는 계산 결과를 PASSWORD_PEPPER로 HMAC-SHA-256 처리해 D1의 검증값과 비교합니다.
느린 KDF는 배포용 Functions 번들에 포함되지 않음을 자동 시험으로 확인합니다.
초기 해시 생성은 로컬 CLI에서만 수행합니다. salt와 반복 횟수는 공개해도 되는 매개변수입니다.

D1에는 브라우저가 보내는 계산 결과 자체를 저장하지 않습니다. HMAC에는 access/admin
구분과 salt를 포함합니다. pepper는 D1·Git·공개 config.js에 저장하지 않고 Cloudflare
Secret으로 관리합니다. 이 로그인 계산 결과도 비밀번호에 준하는 값이므로 기록하거나
공유하면 안 됩니다. 통신은 HTTPS를 사용합니다(로컬 localhost 개발 예외).

토큰은 256비트 난수이며 D1에는 SHA-256 해시만 저장합니다. 접속 세션은 12시간,
관리자 세션은 2시간입니다. 접속 토큰은 sessionStorage, 관리자 토큰은 메모리에 둡니다.
비밀번호 변경은 인증 버전을 올려 기존 세션을 폐기하고 현재 관리자에게 새 토큰을 발급합니다.
로그아웃은 관리자 토큰을 서버에서도 폐기합니다. 로그인은 IP별 분당 10회로 제한합니다.

일반 사용자의 과목/분반 구조 변경과 관리자 상태 전환은 서버가 차단합니다.
교사·배정 편집, 원본 과목 연결, 합산 배정 나누기는 입력 모드에서 가능합니다.
submitted/locked 자료는 관리자가 draft로 다시 열기 전에는 수정할 수 없습니다.

## API

응답: 성공 `{ok:true,data:...}`, 실패 `{ok:false,status,code,message}`와 실제 HTTP 상태.
보호 API는 Authorization: Bearer 토큰을 사용합니다. JSON body와 GET 쿼리를 구분합니다.
서버 응답은 no-store이며 Server-Timing, X-D1-Rows-Read/Written을 제공합니다.

| API | 역할 |
| --- | --- |
| GET /api/access/parameters | 접속 암호 계산 매개변수 |
| POST /api/access/login | 접속 로그인, 선택적으로 초기 workspace |
| GET /api/auth/parameters | 관리자 암호 계산 매개변수(접속 인증 필요) |
| POST /api/auth/login, /api/auth/logout | 관리자 접속/해제 |
| POST /api/auth/password, /api/access/password | 관리자/공용 비밀번호 변경 |
| GET /api/workspace?departmentId=... | 공통 설정·교과군 목록·선택 교과군 |
| GET /api/workspace?all=true | 전체 자료 |
| GET /api/state | 전체 상태 호환 응답 |
| PUT /api/global | 공통 설정·신규 교과군, revision과 operationId 필요 |
| PUT /api/sheets/:id | 교과군 자료, revision/globalRevision/operationId 필요 |

400은 잘못된 자료, 401은 접속 만료, 403은 관리자 권한/잠금, 409는 버전·작업 충돌,
413은 크기 초과, 429는 로그인 제한, 503은 미설정 서버를 나타냅니다.
비밀번호나 토큰은 URL, 성능 측정 JSON, 콘솔에 넣지 않습니다.
