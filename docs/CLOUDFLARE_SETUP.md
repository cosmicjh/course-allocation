# Cloudflare 시험 배포 절차

이 문서는 **새 시험 프로젝트와 새 시험 D1**을 위한 절차입니다. 아직 원격 리소스를
생성하거나 배포하지 않았습니다. 기존 GitHub Pages/외부 운영 서버, 운영 데이터,
main 브랜치를 대상으로 하는 명령은 실행하지 않습니다.

## 1. 로컬 검증

Node.js 24와 pnpm 11.25.0을 준비하고 cloudflare-test에서 작업합니다.

```sh
git branch --show-current
pnpm install --frozen-lockfile
pnpm setup:local
pnpm test:all
pnpm benchmark
pnpm build
```

Windows에서 Node/pnpm이 PATH에 없다면 README의 scripts/run.ps1 도우미를 사용합니다.
일반 로컬 화면을 시작하려면 db:migrate:local → db:seed:local → dev를 순서대로 실행합니다.
통합·브라우저 테스트는 매번 별도의 메모리 D1을 만들며 기존 로컬 DB도 변경하지 않습니다.
test:pages는 test-results/pages-d1-*에 매번 새 로컬 DB를 생성합니다.

## 2. 시험 D1과 미리보기 D1 생성

다음 명령부터는 사용자가 Cloudflare 계정에 로그인해 실행하는 원격 설정 단계입니다.

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create allocation-test
pnpm exec wrangler d1 create allocation-preview
```

생성 결과의 실제 UUID를 wrangler.jsonc에 입력합니다.

- 최상위 d1_databases: allocation-test의 UUID
- env.preview.d1_databases: allocation-preview의 UUID
- 바인딩 이름: 두 환경 모두 DB
- 현재 0000... UUID는 로컬 시험용 자리표시자이며 원격 배포 전에 교체해야 함

시험 DB의 이름과 UUID가 새로 만든 값인지 확인한 뒤 스키마를 적용합니다.

```sh
pnpm exec wrangler d1 migrations apply allocation-test --remote
pnpm exec wrangler d1 migrations apply allocation-preview --remote --env preview
```

Pages의 production/preview 환경은 이 **시험 프로젝트 안의 배포 구분**입니다.
여기서 production이라는 이름이 기존 운영 서비스를 의미하지 않습니다.
별도 미리보기 바인딩을 지정했으므로 PR/다른 브랜치의 시험 자료가 시험 기준 DB를
덮어쓰지 않습니다. 기존 운영 DB의 ID를 이 파일에 넣지 않습니다.

## 3. 초기 인증 비밀값 준비

원격에서는 공개된 가상 비밀번호를 사용하지 말고 별도 시험 비밀번호를 정합니다.
로컬 Node에서 pepper를 생성하고 같은 pepper로 두 검증값을 생성합니다.

PowerShell 예시:

```powershell
$env:PASSWORD_PEPPER = (node scripts/password-hash.mjs --generate-pepper).Trim()
node scripts/password-hash.mjs
node scripts/password-hash.mjs --admin
```

첫 번째 암호 입력은 공용 접속용, --admin 입력은 관리자용입니다. 입력 문자는 표시하지
않고 생성된 검증값만 출력합니다. Unix 셸에서도 PASSWORD_PEPPER를 환경 변수로 설정한 뒤
같은 스크립트를 사용할 수 있습니다. 비밀번호를 명령줄 인수에 넣지 않습니다.

다음 세 값이 필요합니다.

| Cloudflare Secret | 값 |
| --- | --- |
| PASSWORD_PEPPER | 생성한 64자리 난수 hex |
| BOOTSTRAP_ACCESS_HASH | 공용 접속용으로 출력한 pbkdf2-hmac-sha256 검증값 |
| BOOTSTRAP_ADMIN_HASH | --admin으로 출력한 관리자 검증값 |

pepper와 생성한 검증값을 안전한 곳에 보관합니다. 실제 값은 Git, config.js, wrangler.jsonc에
넣지 않습니다. D1에 암호 정보가 없는 최초 요청에서만 BOOTSTRAP 값을 사용합니다.
이후 비밀번호는 관리자 화면에서 변경하며 BOOTSTRAP Secret 수정만으로 초기화되지 않습니다.
PASSWORD_PEPPER는 계속 필요합니다. 별도 재설정 절차 없이 변경하면 기존 비밀번호 검증이 실패합니다.

## 4. 새 Pages 시험 프로젝트

CLI 방식:

```sh
pnpm exec wrangler pages project create course-allocation-test --production-branch cloudflare-test
```

Cloudflare 대시보드 → Workers & Pages → course-allocation-test → Settings에서
Variables and Secrets에 위 세 값을 **Secret(암호화)** 으로 등록합니다.
Production과 Preview 각각 설정합니다. Preview는 다른 pepper/시험 비밀번호를 사용할 수 있습니다.
DB 바인딩은 wrangler.jsonc를 기준으로 관리합니다.

```sh
pnpm build
pnpm exec wrangler pages deploy dist --project-name course-allocation-test --branch cloudflare-test
```

이 명령은 새 시험 프로젝트에만 배포합니다. scripts/에는 자동 원격 배포/운영 DB 이전 명령이 없습니다.
정적 파일만 수동 드래그해서 올리면 Functions가 누락될 수 있으므로 Wrangler 또는 Git 통합을 사용합니다.

GitHub 연동을 원하면 새 Pages 프로젝트에서 이 저장소를 연결하고 다음처럼 설정합니다.

- 기준 배포 브랜치: cloudflare-test
- 프레임워크: None
- 빌드 명령: pnpm build
- 출력 디렉터리: dist
- Node.js: 24, pnpm: 11.25.0(package.json의 packageManager와 동일)
- 기존 운영 프로젝트의 main 기반 배포 설정은 변경하지 않음
- 무료 빌드 횟수를 아끼려면 필요한 시험 브랜치만 자동 배포하도록 제한

## 5. 가상 자료로 배포 확인

처음 DB에는 개인 정보가 없는 '새 학교/새 교과군'만 있습니다.
시험 주소에서 접속 → 관리자 → 복원으로 tests/fixtures/demo-backup.json을 선택하고
교과군별 저장 버튼을 누릅니다. 분반배정 가져오기는 tests/fixtures/course-hours.json을 사용합니다.
실제 교사명, 운영 백업, 운영 스프레드시트를 사용하지 않습니다.

두 브라우저에서 같은 교과군을 동시에 열어 한쪽을 먼저 저장한 뒤 다른 쪽의 충돌과 입력 보존을
확인합니다. 다른 교과군끼리는 저장이 가능합니다. 제출/확정/재개방, 백업/복원,
두 인쇄 버튼, 비밀번호 변경도 확인합니다.

관리자 → 학교 설정 → 성능 측정에서 API 시간과 Server-Timing을 확인합니다.
Cloudflare 대시보드에서 CPU time, 오류(특히 1102/exceededCpu), D1 읽기/쓰기 행 수,
Functions 일일 요청 수를 확인합니다. 로컬 wall time을 배포 환경 CPU time으로 간주하지 않습니다.

## 무료 티어 기준

2026-10-29에 확인한 공식 문서 기준이며 계정의 다른 서비스 사용량도 함께 계산해야 합니다.

| 항목 | Free 한도 | 이 구현의 대응 |
| --- | --- | --- |
| Workers/Functions | 100,000요청/일, CPU 10ms/요청 | /api/*만 함수 실행, 폴링 없음, 느린 KDF는 브라우저 계산 |
| D1 읽기 | 5,000,000행/일 | 교과군 자료 부분 조회, 키·만료 인덱스 |
| D1 쓰기 | 100,000행/일 | 명시적 교과군 저장, 중복 작업 처리, 서버 측 측정값 제공 |
| D1 저장 | 계정 합계 5GB, DB당 500MB | 교과군별 JSON, 작업 결과 7일 정리, 만료 세션 정리 |
| D1 문자열/행 | 2,000,000바이트 | 문서·신규 교과군 묶음당 1,500,000바이트로 사전 제한 |
| D1 복구 | Time Travel 7일 | 별도 JSON 백업 기능도 유지 |

12개 교과군 가상 시험에서 일반 조회는 약 16행 읽기/0행 쓰기, 교과군 저장은
약 14행 읽기/4행 쓰기로 측정됐습니다. 삭제되는 만료 자료와 인덱스 갱신에 따라 달라집니다.
예를 들어 하루 1,000회 조회와 500회 저장은 이 측정 기준 약 23,000행 읽기/2,000행 쓰기입니다.
이는 여유 계산 예시이며 실제 계정의 사용량이나 임의 크기 자료의 CPU 적합성을 보장하지 않습니다.
대형 JSON은 5MB 업로드 제한과 별개로 교과군별 저장 크기 제한을 만족해야 합니다.

## 백업과 되돌리기

시험 DB는 앱의 전체 JSON 백업과 D1 export/Time Travel로 별도로 보관할 수 있습니다.
정적 배포 롤백은 DB 스키마와 데이터를 되돌리지 않습니다. 스키마와 호환되는 코드인지 먼저
확인하고, 자료 복구는 별도 백업으로 수행합니다. 기존 운영 서비스는 이번 시험 배포와 독립적입니다.
운영 전환과 실제 운영 자료 이전은 별도 승인·계획이 필요하며 이번 작업에는 포함되지 않습니다.

공식 문서:

- [Pages Functions 바인딩](https://developers.cloudflare.com/pages/functions/bindings/)
- [Pages Wrangler 환경 설정](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Pages Functions 라우팅](https://developers.cloudflare.com/pages/functions/routing/)
- [D1 마이그레이션](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 무료 사용량](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 크기·복구 제한](https://developers.cloudflare.com/d1/platform/limits/)
- [Workers CPU·요청 제한](https://developers.cloudflare.com/workers/platform/limits/)
