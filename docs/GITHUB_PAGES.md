# GitHub 접속 주소 — 2026-11-02

접속 주소: https://cosmicjh.github.io/course-allocation/

주소를 Cloudflare로 이동시키는 리디렉션 대신 GitHub Pages에서 실제 앱 화면을 제공합니다.
로그인·조회·저장은 기존 https://course-allocation.pages.dev/api 를 이용합니다.
기존 운영 D1, 인증 Secret과 비밀번호, 교과군별 버전·충돌 방지 방식은 그대로 유지합니다.
Cloudflare의 기존 화면 주소도 계속 동작합니다. 자료 이전·초기화·성능 최적화는 하지 않습니다.

## 게시 설정

- GitHub 저장소: cosmicjh/course-allocation, 기준 브랜치 main.
- Settings → Pages → Build and deployment → Source: GitHub Actions.
- 워크플로: `.github/workflows/pages.yml`.
- main push 또는 workflow_dispatch로 정적 파일을 빌드·게시합니다.
- `pnpm build:github`가 `dist-github/`에 index.html, 공개 config.js, shared/만 생성합니다.
- `/course-allocation/` 경로에서도 상대 JS 모듈 경로가 유지됩니다.
- 서버 소스·DB·Secret·다른 작업 폴더는 게시 출력에 복사하지 않습니다.
- 게시 전 Cloudflare API의 GitHub CORS 준비 상태를 확인합니다.

Cloudflare 프로젝트는 계속 main을 자동 배포하며 기존 D1을 사용합니다.
별도의 원격 시험 프로젝트나 DB를 만들지 않습니다.

## API 연결과 인증

GitHub 빌드의 공개 설정은 `apiBase: https://course-allocation.pages.dev/api`입니다.
서버는 정확한 `https://cosmicjh.github.io` Origin에만 외부 CORS를 허용하고,
브라우저 클라이언트도 위 GitHub 출처와 정확한 Cloudflare API 주소 조합만 허용합니다.
웹 표준의 Origin에는 `/course-allocation/` 같은 경로가 포함되지 않습니다.
OPTIONS는 GET/POST/PUT와 Authorization/Content-Type 헤더만 허용합니다.
Server-Timing·D1 행 수 응답 헤더도 읽을 수 있어 기존 성능 측정 화면을 유지합니다.
비밀번호·토큰은 URL에 넣지 않으며 기존 토큰 인증과 서버 권한·버전 검사를 계속 적용합니다.

접속 도메인이 바뀌므로 최초 GitHub 접속에서는 기존 접속 비밀번호로 다시 로그인합니다.
초기 로그인 정보는 Git에서 제외한 `.cache/cloudflare-production/LOGIN.local.md`에 있습니다.
관리자 화면에서 이후 변경한 비밀번호가 있다면 변경한 값을 사용합니다.

## 검증

`pnpm test:all`은 가상 자료만 있는 로컬 D1에서 다음을 확인합니다.

- 자동 업무·API·보안 테스트 28개: CORS 허용·거부, API 주소 제한, 버전 충돌 포함.
- 기존 로컬 화면의 브라우저 기능 시나리오 10개.
- GitHub 주소·하위 경로·Cloudflare API 구성을 사용하는 브라우저 기능 시나리오 10개.
- Pages Functions 빌드와 로컬 D1 마이그레이션·가상 자료 적재.

GitHub 주소를 사용하는 로컬 브라우저 시험도 API 요청을 반드시 로컬 가상 DB로 전달합니다.
운영 DB에 시험 자료를 넣지 않습니다. 실제 게시 후에는 접속 주소, JS 설정과 모듈,
CORS preflight, 로그인 및 초기 조회를 확인합니다. 기존 운영 자료를 편집하는 시험은 하지 않습니다.

공식 참고: [GitHub Pages 사용자 지정 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
