# main 전환과 시험 자원 정리 — 2026-10-30

Cloudflare 시험에서 검증한 구현을 main에 반영하고 기존 `course-allocation` Pages 프로젝트의
운영 브랜치를 main으로 전환했습니다. 운영 주소는 https://course-allocation.pages.dev 입니다.
이번 작업에는 추가 성능 개선이나 원격 부하 측정을 포함하지 않습니다.

## 보존과 전환

- 기존 HTML 디자인, 배당·제출·확정, 관리자, JSON, 인쇄와 교과군별 버전·충돌 방지 동작을 보존합니다.
- 시험 브랜치의 GitHub 추가 커밋도 병합해 변경 이력을 보존합니다. 이전 main은 Git 이력에 남습니다.
- 새 운영 D1 `course-allocation-db`에 초기 스키마만 적용합니다. 교사·과목·배정 가상 자료는 옮기지 않습니다.
- 운영용 인증 Secret을 새로 생성하며 Git에서 제외한 로컬 파일로 전달합니다.
- 기존 외부 운영 서버와 스프레드시트는 변경하지 않으며 실제 자료 자동 이전은 하지 않습니다.
- 일반 자동 테스트·가상 fixture·벤치마크와 기존 성능 측정 기능은 재사용 가능한 검증 도구로 유지합니다.
- 과거 구조 분석·이전 계획·시험 결과 문서는 검증 이력으로 보존합니다.

## 정리 대상

| 범위 | 대상 |
| --- | --- |
| GitHub | 병합 완료한 cloudflare-test 시험 브랜치, 일회성 시험 Actions 실행·산출물 |
| 기존 정적 호스팅 | GitHub Pages 비활성화, github-pages 환경 삭제 |
| Cloudflare Pages | course-allocation-test 프로젝트와 해당 배포·미리보기 주소 |
| Cloudflare D1 | course-allocation-test-db, course-allocation-preview-db와 가상 자료·시험 인증·세션 |
| 운영 프로젝트 | 과거 cloudflare-test 배포 기록과 시험 브랜치 설정, 자동 미리보기 배포 |
| 저장소 | 일회성 Cloudflare 시험 생성·원격 시험·로그·집계·보고서 생성 스크립트 8개, remote-harness, .nojekyll, 비어 있던 assets 디렉터리 |
| 로컬 | 정리 완료 후 시험용 인증 파일과 배포 임시 파일 |

운영 배포와 새 DB 연결을 먼저 검증한 다음 시험 자원을 삭제합니다. 삭제 직전 D1 자료가
시험 fixture 또는 빈 초기 상태인지 재확인하며 소유 표시가 다른 자료는 삭제하지 않습니다.
GitHub의 다른 자료나 Cloudflare 계정의 다른 서비스는 삭제하지 않습니다.

## 검증

main 반영 전 가상 자료 기반 업무·API·보안 테스트, 브라우저 10개 시나리오와 Pages 빌드·
로컬 D1 마이그레이션을 확인합니다. 운영 배포 후 health, 접속·관리자 인증, 초기 자료 조회와
가상 교사·과목 0건을 확인합니다. 원격 운영 자료를 가상 fixture로 덮어쓰는 시험은 하지 않습니다.

반영 전 로컬 검증: 업무·API·보안 25개, 브라우저 10개 시나리오, Pages Functions 빌드·
D1 마이그레이션·가상 자료 적재 3단계가 모두 통과했습니다. 정리 과정에서 앱 업무 코드·
디자인·저장·인증·성능 코드는 변경하지 않았습니다.

## 완료 결과

2026-10-30 14:45(한국 시간) 기준:

- main 반영 커밋: `703b2ad06413b41b793b3e636987edccb6daf078`.
- 해당 커밋의 Cloudflare 자동 배포: `0f2941bf-70d4-4a40-ab38-78bad58fb769`, 성공.
- [GitHub Actions 회귀 테스트](https://github.com/cosmicjh/course-allocation/actions/runs/41009777385): 성공.
- 운영 주소의 health, 접속 인증, 관리자 인증, 초기 교과군 조회: 성공.
- 운영 DB: 교과군 기본값 1개, 교사 0명, 과목 0개, 저장 작업 기록 0개.
- Cloudflare 시험 프로젝트 1개와 그 전체 배포·미리보기, 운영 프로젝트의 과거 시험 배포 10건 삭제.
- 가상 자료가 든 시험 D1과 빈 미리보기 D1, 합계 2개 삭제. 삭제 직전 가상 자료 소유 표시를 확인.
- GitHub 원격 시험 브랜치와 로컬 시험·승격 준비 브랜치 삭제. main만 남음.
- GitHub 시험 Actions 실행 7건 삭제. 관련 시험 산출물도 제거돼 잔여 시험 실행·산출물 0건.
- 기존 GitHub Pages 비활성화, `github-pages` 배포 환경 삭제. 기존 main의 코드 변경 이력은 보존.
- Cloudflare 잔여 자원은 `course-allocation` Pages와 `course-allocation-db` D1 각각 1개.
- 자동 미리보기 배포 비활성화, 운영 DB 연결 유지, 시험 자원 삭제 후에도 `/api/health` 정상.

이후 완료 기록과 빈 디렉터리 정리만 별도 main 커밋에 반영합니다. 앱 실행 코드는 위 검증한
커밋과 같습니다. 운영 초기 로그인 정보는 Git에 올리지 않은
`.cache/cloudflare-production/LOGIN.local.md`로 전달합니다. 운영 DB에는 실제 자료를 자동으로
옮기지 않았으며 기존 스프레드시트의 운영 자료는 변경하지 않았습니다.
