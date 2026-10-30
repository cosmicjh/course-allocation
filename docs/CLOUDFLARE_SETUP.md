# Cloudflare 운영 설정

운영 주소는 https://course-allocation.pages.dev, GitHub 기본 브랜치는 `main`입니다.
전환·정리 기록은 [main 배포 기록](MAIN_RELEASE_2026-10-30.md), 과거 가상 자료 검증은
[시험 배포 보고서](CLOUDFLARE_DEPLOYMENT_2026-10-30.md)를 참고합니다.

## 현재 구성

| 항목 | 설정 |
| --- | --- |
| Pages 프로젝트 | course-allocation |
| Git 저장소 | cosmicjh/course-allocation |
| 운영 브랜치 | main |
| 빌드 명령 | pnpm run build |
| 출력 디렉터리 | dist |
| Node.js / pnpm | 24 / 11.25.0 |
| D1 바인딩 | DB |
| 운영 D1 | course-allocation-db |
| compatibility_date | 2026-07-30 |
| 자동 미리보기 배포 | 비활성화 |

실제 운영 DB UUID는 `wrangler.jsonc`에서 관리합니다. 미리보기의 D1 바인딩은 명시적으로
빈 배열로 설정해 운영 DB를 상속하지 않습니다. 향후 미리보기가 필요하면 별도 DB와
인증 Secret을 먼저 준비한 뒤 활성화합니다. 운영 DB에 가상 fixture를 적재하지 않습니다.

## 로컬 개발과 확인

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm test:all
pnpm build
```

Windows에서는 `scripts/run.ps1`에 같은 작업명을 전달할 수 있습니다.
자동 테스트는 별도 로컬 D1과 가상 자료만 사용합니다. 운영 자료에 쓰지 않습니다.
로컬 앱 실행은 README의 로컬 마이그레이션·가상 자료 적재 절차를 따릅니다.
기존 벤치마크와 앱의 성능 측정 기능은 유지하며, 이번 main 반영에서는 추가 최적화를 하지 않습니다.

## 인증 Secret

다음 세 값을 Cloudflare Pages → Settings → Variables and Secrets에 암호화된 Secret으로
설정합니다. 실제 값을 Git이나 공개 설정에 넣지 않습니다.

| Secret | 용도 |
| --- | --- |
| PASSWORD_PEPPER | 64자리 난수 hex, 계속 보존해야 하는 서버 비밀값 |
| BOOTSTRAP_ACCESS_HASH | 최초 공용 접속용 검증값 |
| BOOTSTRAP_ADMIN_HASH | 최초 관리자용 검증값 |

운영 초기 접속 정보는 `.cache/cloudflare-production/LOGIN.local.md`, 복구용 Secret은 같은
폴더의 `credentials.local.json`에 보관합니다. 두 파일 모두 Git 제외입니다. 별도로 안전하게
보관해야 하며 공개된 로컬 가상 비밀번호를 운영에 사용하지 않습니다.

다른 새 환경을 만들 때는 동일한 pepper로 두 검증값을 만듭니다.

```powershell
$env:PASSWORD_PEPPER = (node scripts/password-hash.mjs --generate-pepper).Trim()
node scripts/password-hash.mjs
node scripts/password-hash.mjs --admin
```

비밀번호를 명령줄 인수에 넣지 않습니다. 암호 입력은 표시되지 않습니다.
BOOTSTRAP은 D1에 인증 정보가 없는 최초 요청에서만 적용됩니다. 이후 암호는 관리자 화면에서
변경합니다. BOOTSTRAP만 바꿔서는 기존 암호가 초기화되지 않습니다. 기존 pepper를 임의로
바꾸면 인증이 실패하므로 운영 데이터와 함께 보존해야 합니다.

## main 배포

GitHub 연동은 `main` push를 자동 배포합니다. 다른 브랜치·PR의 미리보기 배포는 꺼 둡니다.
Pages의 빌드 환경에는 `NODE_VERSION=24`, `PNPM_VERSION=11.25.0`을 지정합니다.
변경 사항을 검증한 뒤 main으로 반영합니다.

직접 배포해야 할 경우:

```sh
pnpm exec wrangler login
pnpm build
pnpm exec wrangler pages deploy dist --project-name course-allocation --branch main
```

Pages 명령은 기본 `wrangler.jsonc`를 사용하며 사용자 지정 `--config`와 `account_id` 설정을
사용하지 않습니다. 계정 선택이 필요하면 `CLOUDFLARE_ACCOUNT_ID` 환경 변수를 사용합니다.
정적 파일만 수동 업로드하면 Functions가 누락될 수 있으므로 Wrangler나 Git 연동을 사용합니다.

이번 운영 DB는 새로 만든 빈 DB에 `0001_init.sql`만 적용합니다. 이후 새 마이그레이션이
있을 때는 대상 이름·UUID와 백업을 확인한 뒤 적용합니다.

```sh
pnpm exec wrangler d1 migrations apply DB --remote
```

`tests/fixtures/demo.sql`과 `db:seed:local`은 로컬 시험 전용입니다. 원격 운영 DB를 초기화하는
명령으로 바꾸지 않습니다. 기존 스프레드시트는 변경하지 않았으며 실제 운영 자료 자동 이전은
실행하지 않습니다. 필요 시 앱의 JSON 백업·복원을 이용해 별도로 이관할 수 있습니다.

## 배포 확인과 복구

`/api/health`에서 D1 연결을 확인하고, 로그인·관리자 진입·교과군 조회를 확인합니다.
운영 확인 때문에 가상 교사·과목을 추가하지 않습니다. 기능·충돌·JSON·인쇄 회귀 검증은
운영 DB와 독립된 자동 테스트로 수행합니다.

운영 자료는 앱의 JSON 백업, D1 export, Time Travel로 보관합니다. 정적 배포 롤백만으로
DB는 되돌아가지 않습니다. 코드/스키마 호환성을 확인하고 자료 복구는 별도로 수행합니다.
과거 시험 배포는 삭제하므로 롤백 대상으로 사용하지 않습니다.

## 무료 티어

2026-10-29 공식 문서 확인 기준입니다. 다른 앱의 계정 사용량도 합산합니다.

| 항목 | Free 한도 |
| --- | --- |
| Workers/Functions | 100,000요청/일, CPU 10ms/요청 |
| D1 읽기 / 쓰기 | 5,000,000행 / 100,000행/일 |
| D1 저장 | 계정 합계 5GB, DB당 500MB |
| D1 문자열·행 | 2,000,000바이트 |
| D1 Time Travel | 7일 |

Functions는 `/api/*`에만 실행되고 주기적 폴링이나 유료 자원은 사용하지 않습니다.
문서·신규 교과군 묶음은 1,500,000바이트로 사전 제한합니다. 과거 대량 신규 반영에서
CPU 17ms가 관측됐으므로 임의 규모가 항상 Free CPU 한도 안에 든다고 보장하지 않습니다.
성능 개선은 다음 단계로 남겨 두며 이번에는 기존 동작을 유지합니다.

공식 문서:

- [Pages Git 연동](https://developers.cloudflare.com/pages/configuration/git-integration/)
- [Pages 설정 API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/)
- [Pages Wrangler 환경 설정](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [D1 마이그레이션](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 무료 사용량](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 크기·복구 제한](https://developers.cloudflare.com/d1/platform/limits/)
- [Workers CPU·요청 제한](https://developers.cloudflare.com/workers/platform/limits/)
