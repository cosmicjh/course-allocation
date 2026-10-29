# 교과 시수배당 · Cloudflare 시험 버전

기존 HTML 디자인, 교과군별 배당, 실제 하위 분반, 검증·제출·확정, 관리자 설정,
JSON 가져오기·백업·복원, CSV, 인쇄를 유지한 Pages + Functions + D1 구현입니다.
브라우저와 서버는 동일한 업무 검증 모듈을 사용합니다. 실행 코드에서 기존 외부 서버와
스프레드시트 연결을 제거했습니다.

개발 브랜치: **cloudflare-test**. 기존 운영 데이터와 main은 변경하지 않았습니다.
기존 서버를 호출하거나 자료를 자동으로 복사하는 코드는 없습니다.

## 문서

- [기존 구조와 전환 계획](docs/MIGRATION_PLAN.md)
- [구현 구조·저장·인증 계약](docs/ARCHITECTURE.md)
- [Cloudflare 시험 배포 절차와 무료 한도](docs/CLOUDFLARE_SETUP.md)
- [검증 범위와 성능 측정 방법](docs/VALIDATION.md)
- [최종 로컬 시험 결과](docs/TEST_RESULTS.md)

## 로컬 시작

Node.js 24와 pnpm 11.25.0을 사용합니다.

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev
```

주소는 Wrangler가 출력합니다(기본 `http://localhost:8788`).
가상 시험 접속 비밀번호는 `virtual-access-2026`, 관리자 비밀번호는 `virtual-admin-2026`입니다.
이 값은 로컬 setup 스크립트에서만 사용하며 배포용 초기값으로 자동 적용되지 않습니다.
`db:seed:local`은 로컬 시험 DB의 교과군 자료를 비우고 가상 자료를 넣습니다.

Windows에서는 설치된 도구 또는 Codex의 번들 런타임을 찾는 도우미도 사용할 수 있습니다.

```powershell
.\scripts\run.ps1 install --frozen-lockfile
.\scripts\run.ps1 setup:local
.\scripts\run.ps1 db:migrate:local
.\scripts\run.ps1 db:seed:local
.\scripts\run.ps1 dev
```

## 시험

```sh
pnpm test             # 업무 규칙·보안·실제 로컬 D1 통합 시험
pnpm test:browser     # 화면, 충돌, 저장 재시도, JSON, 관리자, 인쇄 시험
pnpm test:pages       # Wrangler Functions 빌드 및 별도 로컬 D1 마이그레이션
pnpm test:all
pnpm benchmark        # 가상 규모 자료 조회/저장 30회씩 측정
```

Windows 브라우저 시험은 설치된 Edge를 사용합니다. 다른 환경에서는 먼저
`pnpm exec playwright install --with-deps chromium`을 실행합니다.
Windows 도우미로는 `.\scripts\run.ps1 test:all`, `.\scripts\run.ps1 benchmark`를 실행합니다.
로컬 서버 연결·프로세스 실행 권한이 필요합니다. 원격 Cloudflare 계정은 필요하지 않습니다.

측정 결과·화면 PNG·인쇄 SVG는 `test-results/`에 생성되고 Git에 포함되지 않습니다.
앱의 관리자 → 학교 설정 → **성능 측정**에서도 현재 탭의 API/DB 시간과 JSON을 볼 수 있습니다.

## 디렉터리

```text
index.html, config.js       기존 화면과 공개 설정
shared/                    업무 규칙, 과목 목록, 인쇄, JSON, HTTP, 성능, 암호 계산
functions/api/[[path]].js   Pages API 진입점
server/                    D1, 권한, 인증, 서버 검증
migrations/                D1 스키마
scripts/                   빌드, 로컬 설정, 암호 해시 생성, 벤치마크
tests/                     가상 자료 및 자동 시험
dist/                      정적 배포 파일만 생성하는 출력 디렉터리
```

기존 화면의 CSS는 원본과 해시를 비교하는 회귀 시험으로 보호합니다.
정적 출력에는 server/, migrations/, tests/, .dev.vars가 포함되지 않습니다.
루트 `.nojekyll`은 기존 저장소의 파일이며 Cloudflare 빌드에서는 사용하지 않습니다.
 
