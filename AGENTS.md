# 프로젝트 공통 지침

## 목적과 구조

교과 시수배당을 편집·검증·제출·확정하고 JSON 가져오기·백업·복원, CSV와 인쇄를 제공한다.
JavaScript ES modules, Cloudflare Pages Functions + D1을 사용하며 GitHub Pages에서도 화면을 제공한다.
Node.js는 `package.json` 기준 22 이상, 개발·CI 기준 24이며 pnpm은 11.25.0이다.

- `index.html`, `config.js`: 화면과 공개 클라이언트 설정.
- `shared/`: 브라우저·서버가 공유하는 업무 규칙, 상태, 가져오기, 인쇄, 통신과 암호 계산.
- `server/`: API, D1 저장, 인증·권한과 서버 검증.
- `functions/api/`: Pages Functions API 진입점과 health 경로.
- `migrations/`: D1 스키마 변경 이력.
- `scripts/`: 빌드, 로컬 설정, 암호 해시와 벤치마크 도구.
- `tests/`: 단위·통합·브라우저·Pages 시험과 가상 픽스처.
- `docs/`: 구조, 운영·복구 기록, 검증 계약과 승인된 설계(`docs/design/`).
- `.github/workflows/`: 시험과 GitHub Pages 게시 워크플로.
- `dist/`, `dist-github/`, `test-results/`: Git에서 제외하는 생성 산출물.

`timetable-cloudflare/`, `class-swap-cloudflare/`, `studyroom_codex_handoff/`는 별도 저장소/프로젝트다.
명시적인 작업 지시가 없으면 내용을 열람·복사·수정하지 않는다.

## 구현과 데이터 보호

- 실용성과 유지보수성을 우선하고 필요한 부분만 최소 변경한다. 기존 코드와 공유 모듈을 재사용한다.
- 적절히 모듈화하고 중복을 줄이되 불필요한 추상화는 만들지 않는다. 단순한 문제는 단순하게 풀고 근본 원인을 해결한다.
- 새 파일과 의존성은 필요할 때만 추가한다. 정리와 동작 변경을 섞지 않는다.
- 기존 기능·데이터·백업 형식과 ID, 배정 시수, 버전·충돌·재시도 보호를 유지한다.
- 학교 업무 데이터의 무결성과 개인정보를 보호한다. 입력 경계와 서버에서 검증하고 시험·문서에는 가상 자료만 쓴다.

## UI/UX

- 미니멀한 모노톤과 Pretendard를 유지하고 불필요한 안내 문구와 장식을 줄인다.
- 반응형 배치, 접근성, 키보드 조작과 명확한 상태 표시를 지킨다.
- 성능·응답 속도·조작 편의를 고려한다. 로딩 중 입력이나 화면 전환으로 미저장 데이터가 사라지지 않게 한다.

## 실행과 검증

실행 명령은 `package.json`을 기준으로 한다.

```sh
pnpm dev
pnpm build
pnpm build:github
pnpm test
pnpm test:browser
node tests/browser.mjs --github
pnpm test:pages
pnpm test:all
pnpm benchmark
```

로컬 초기화는 README를 따른다. `pnpm setup:local`은 비밀값 파일과 가상 픽스처를 생성할 수 있고,
`pnpm db:migrate:local`, `pnpm db:seed:local`은 로컬 DB를 변경한다. 기존 자료와 작업 범위를 먼저 확인한다.
암호 해시는 `pnpm password:hash`로 생성하며 출력·전달 과정에서도 비밀값을 보호한다.

- `docs/VALIDATION.md`가 검증 계약이다. 관련 불변조건·단위·통합·브라우저 검증의 실제 결과로 완료를 판단한다.
- 실행한 명령, 종료 코드와 결과를 보고하고 실행하지 못한 항목은 미검증으로 표시한다.
- 검증 계약과 불변조건 테스트는 사용자 승인 없이 변경하지 않는다.
- 배정 제약, 시간표 솔버 동작, 인증·권한·출석, 학생 데이터 처리, DB 마이그레이션은 고위험 변경이다.
  병합 전에 설계·검증 계약·실제 코드와 테스트를 대조하는 독립 검토를 거친다.
  Claude가 설계한 작업은 새 Codex 스레드에서 검토하고, 그 밖의 고위험 작업에도 독립 리뷰어를 배정한다.
  검토자에게도 같은 파일 접근 제한을 적용한다.

## 보안과 작업 제한

- `.dev.vars`, 인증 정보와 비밀값을 커밋·로그·공개 설정에 넣지 않는다.
- 운영 DB·운영 자격 증명·실제 학생 정보에 접근하지 않는다. 시험은 별도 로컬 DB와 가상 자료만 사용한다.
- 사용자 변경을 보존한다. 강제 checkout, `reset --hard`, force push를 금지하고 동의 없이 stash·rebase·merge하지 않는다.
- push와 배포는 사용자 승인 후 수행한다.
- 자동 실행·라이프사이클 훅을 등록·신뢰·활성화하지 않는다. 예약 작업·상주 서비스도 등록하지 않는다.
- 무인 모델 호출과 자동 병합·push·배포를 수행하지 않는다.

## 설계와 협업

- Claude Code는 조정자로 요구사항과 설계를 정리하고 Orca orchestration으로 작업을 맡긴다. Codex는 구현·테스트·수정을 수행한다.
- 구현 전에 관련 사용자 승인 설계(`docs/design/`)를 읽고 아키텍처 결정의 기준으로 삼는다. 파일별 구현 세부 사항은 Codex가 결정한다.
- Codex 워커는 현재 공식 CLI 명령을 `orca skills get orchestration`으로 확인한다.
  질문은 Orca `ask`, 완료는 `worker_done`으로 변경 파일과 실제 검증 결과를 포함해 조정자에게 보고한다.
- 승인된 설계가 코드·전제와 충돌하거나 같은 문제에 서로 다른 수정이 두 번 실패하면 관련 작업을 멈추고 근거·영향을 보고한다.
  설계 충돌은 사용자 결정 전 임의로 변경하지 않는다. 도구 실행·시험 환경 설정 실패는 수정 시도로 세지 않는다.
