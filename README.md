# AudiSay

> 한 줄 소개를 작성해 주세요.

## 폴더 구조

```
backend/    Spring Boot API 서버
frontend/   React 웹
ai/         FastAPI AI 워커
infra/      docker-compose, 배포 설정
```

## 시작하기

```bash
git clone https://lab.ssafy.com/<그룹>/S15P31D101.git
cd S15P31D101
cp .env.example .env      # 값은 팀 내부에서 따로 공유
git checkout -b feat/S15P31D101-이슈번호-작업명 origin/develop
```

## 브랜치 전략

```
main ← develop ← 작업 브랜치 (feat, fix, docs …)
```

- `main`: 배포용, develop에서 MR로 병합하면 자동 배포
- `develop`: 개발 통합 브랜치 (기본 브랜치)
- 작업 브랜치: `{prefix}/S15P31D101-이슈번호-작업명`

## 커밋 메시지

```
{type}({scope}): {subject}
```

- 예) `feat(be): 로그인 API 구현`
- type: feat, fix, hotfix, refactor, docs, test, chore
- scope: fe, be, ai, infra, docs

자세한 규칙은 Notion의 Git 컨벤션 페이지를 참고하세요.
