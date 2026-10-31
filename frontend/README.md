# AudiSay Frontend

시각장애인을 위한 유튜브 화면해설 플레이어 AudiSay의 웹 프론트엔드입니다.
**사용자는 화면을 보지 않고 듣고 조작합니다.** 모든 작업은 이 전제에서 출발합니다.

- 접근성 원칙: 프로젝트 문서 `AudiSay 화면 접근성 설계 원칙.md` (반드시 먼저 읽기, 사용자 화면 기준)
- API 명세: Notion `📔 API 명세서` (Base URL `/api/v1`)
- 디자인: Figma `Audisay`

## 시작하기

```bash
nvm use            # Node 22 (.nvmrc)
npm ci
cp .env.example .env.local
npm run dev        # http://localhost:5173, /api 는 localhost:8080 백엔드로 프록시
```

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run lint` | ESLint (jsx-a11y strict 포함) |
| `npm test` | Vitest + Testing Library + axe 접근성 검사 |
| `npm run build` | 타입 검사 후 배포용 빌드 |
| `npm run format` | Prettier 정리 |

커밋 전에 `npm run lint && npm test && npm run build` 를 통과시킵니다. CI(Docker 빌드)에서도 같은 검사가 돌고, 실패하면 배포되지 않습니다.

## 폴더 구조

```
src/
  api/          API 호출 (client, 타입, 에러 문구 사전, SSE, queryKeys)
  app/          라우터, Provider 조립, QueryClient
  components/ui/ 공통 UI 부품 (Button, TextField, Dialog, Tabs …)
  features/
    announcer/  낭독 안내 (announce, 다시 듣기, 진행률 안내)
    auth/       로그인 상태, 역할별 이동, 권한 가드
    settings/   재생 설정 (글자 크기·고대비 → <html data-*>)
    shortcuts/  단축키 등록, 단축키 안내 창
    page/       usePageEntry (화면 진입 처리)
    audio/      해설 음성 재생 (TTS 대체 포함)
  layouts/      AppLayout · AuthLayout · AdminLayout · BareLayout
  pages/        화면 (지금은 PlaceholderPage 로 자리만 잡혀 있음)
  styles/       Tailwind v4 토큰 · 전역 스타일
  test/         테스트 도구, 앱 전체 테스트
  utils/        시간 표기 등
```

## 반드시 지킬 규칙

**화면 구조**
- 페이지는 `<main>` 을 그리지 않습니다 (레이아웃이 그림). 최상위는 `<h1>` 하나부터 시작합니다.
- 모든 페이지 맨 위에서 `usePageEntry({ title, announce, focusRef })` 를 부릅니다. 안내 문구에서 말한 위치("검색 칸에 있어요")에 실제로 포커스가 가야 합니다.
- 새 화면은 `app/router.tsx` 에서 해당 `PlaceholderPage` 를 실제 페이지로 바꿔 끼웁니다.

**소리**
- 상태 안내는 `useAnnouncer().announce()` 로만 합니다. 컴포넌트에 `aria-live` 를 직접 달지 않습니다.
- 시청 화면 '해설' 박스는 live 영역이 아닙니다 (서버 TTS 가 이미 읽음).
- 진행률은 `useProgressAnnounce` 로 단계 변경·10% 단위만 읽습니다.

**부품과 버튼**
- 버튼·입력·선택·대화창은 `components/ui` 부품을 씁니다. 직접 만들기 전에 팀에 먼저 공유합니다.
- 비활성은 `<Button disabled>` 로 넘깁니다 (내부에서 `aria-disabled` 로 처리해 Tab 순서에 남김).
- 반복되는 버튼은 이름에 대상을 넣습니다 ("재생, 김치볶음밥 10분이면 충분해요").
- 켜고 끄는 버튼은 이름을 바꿉니다 ('즐겨찾기' ↔ '즐겨찾기 해제'). `aria-pressed` 와 함께 쓰지 않습니다.

**키보드**
- 단축키는 `useShortcut(combo, handler, { description, scope })` 로만 등록합니다. 조합은 `Alt+Shift+키` 를 기본으로 합니다.
- 한 글자 키(1/2/3)는 해당 영역에 포커스가 있을 때만 동작하게 합니다.

**스타일**
- 색은 토큰 클래스만 씁니다 (`bg-navy`, `text-ink`, `border-line` …). 고대비 모드가 토큰을 바꿔 끼웁니다.
- 크기는 `rem` 기반 유틸리티만 씁니다. `px` 는 테두리 두께에만 씁니다 (글자 크기 5단계가 깨짐).
- 노란 글자는 남색 배경 위에서만 씁니다 (흰 바탕 위 노랑은 대비 부족).
- 조작 요소 높이는 56px(`min-h-touch`) 이상입니다.

**관리자 화면**
- 관리자 화면은 비장애인 운영자 기준입니다 (원칙 문서 12장). 공통 부품은 그대로 쓰되, 낭독용 문구·낭독기 검사는 하지 않습니다.
- 시맨틱 HTML, 키보드 조작, lint 통과는 지킵니다. 글자 크기·대비는 기본값으로 고정됩니다.

**코드**
- 훅·타입은 `features/*/context`, Provider 컴포넌트는 `features/*/*Provider` 에서 import 합니다.
- 파일 하나에 컴포넌트 하나 (Fast Refresh 경고 방지).
- API 는 `request<T>()` 로 부르면 응답 봉투가 벗겨진 `data` 만 옵니다. 오류는 `toUserMessage(err)` 로 쉬운 말 문구를 얻어 announce 합니다.

## 새 화면 만들 때 체크리스트

와이어프레임의 여섯 항목을 코드로 옮겼는지 확인합니다.

- [ ] 포커스(Tab) 순서 = DOM 순서 = 와이어프레임 번호 순서
- [ ] 진입 안내 문구 (`usePageEntry` 의 `announce`)
- [ ] 상태가 바뀔 때 읽어 줄 문구와 빈도 (`announce`, `useProgressAnnounce`)
- [ ] 단축키 (`useShortcut`, 단축키 안내 창에 자동 표시)
- [ ] 연결된 API 경로 (`src/api/*`, `queryKeys`)
- [ ] 요구사항 항목 이름
- [ ] 테스트 1개 이상 (axe 검사 포함)

## 테스트 작성

```tsx
// 컴포넌트 하나: Provider 가 필요 없으면 render, 필요하면 renderWithProviders
renderWithProviders(<MyPage />)

// 라우트 전체(가드·레이아웃 포함)를 특정 주소에서 시작
const { router } = renderRoute('/login')
```

로그인 상태는 `@/api/client` 의 `reissueAccessToken`, `@/api/users` 의 `usersApi.me` 를 `vi.mock` 으로 바꿔서 만듭니다. 예시는 `src/test/guards.test.tsx` 에 있습니다.