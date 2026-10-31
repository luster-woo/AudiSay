import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { RootProviders } from './providers'
import type { RouteHandle } from './routeHandle'
import { RequireAuth } from '@/features/auth/guards/RequireAuth'
import { RequireRole } from '@/features/auth/guards/RequireRole'
import { RedirectIfAuthed } from '@/features/auth/guards/RedirectIfAuthed'
import { AppLayout } from '@/layouts/AppLayout'
import { AuthLayout } from '@/layouts/AuthLayout'
import { BareLayout } from '@/layouts/BareLayout'
import PlaceholderPage from '@/pages/PlaceholderPage'
import NotFoundPage from '@/pages/errors/NotFoundPage'
import RouteError from '@/pages/errors/RouteError'
import RootError from '@/pages/errors/RootError'

/** 임시 페이지 라우트. 실제 페이지를 만들면 element 를 바꾼다 */
const page = (path: string, handle: RouteHandle): RouteObject => ({
  path,
  element: <PlaceholderPage />,
  handle,
})

/** 로그인 전에만 보는 화면 (로그인 상태면 RedirectIfAuthed 가 돌려보낸다) */
const publicRoutes: RouteObject[] = [
  {
    element: <BareLayout />,
    children: [
      page('landing', {
        title: '시작하기',
        announce: 'AudiSay 예요. 지금 시작하기 버튼이 있어요.',
      }),
    ],
  },
  {
    element: <AuthLayout />,
    children: [
      page('login', { title: '로그인', announce: '로그인 화면이에요. 이메일 칸에 있어요.' }),
      page('signup', { title: '회원가입', announce: '회원가입 화면이에요.' }),
    ],
  },
]

/** 로그인한 사용자 화면 (헤더 + 주 메뉴 + 방금 안내 띠) */
const userRoutes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <PlaceholderPage />,
        handle: { title: '홈', announce: '홈이에요. 검색 칸에 있어요.' } satisfies RouteHandle,
      },
      page('search', { title: '검색 결과' }),
      page('register', { title: '영상 등록' }),
      page('register/upload', { title: '영상 파일 올리기' }),
      page('register/upload/title', { title: '제목 정하기' }),
      page('register/upload/open', { title: '공개 범위 정하기' }),
      page('upload/:videoId', { title: '영상 올리는 중' }),
      page('upload/:videoId/failed', { title: '업로드 끊김' }),
      page('jobs/:jobId', { title: '해설 만들기' }),
      page('watch/:videoId', { title: '영상 보기' }),
      page('tutorial/:step', { title: '사용법' }),
      page('verify', {
        title: '시각장애인 인증',
        announce: '시각장애인 인증 화면이에요. 서류 한 장만 올리면 돼요.',
      }),
      page('me', { title: '내 정보' }),
      page('me/videos', { title: '내 영상' }),
      page('help', { title: '도움말' }),
    ],
  },
]

/** 관리자 화면. AdminLayout 은 lazy 로 불러와 일반 사용자 번들에 섞이지 않게 한다 */
const adminRoutes: RouteObject[] = [
  {
    path: 'admin',
    element: <RequireRole allow="ADMIN" />,
    children: [
      {
        lazy: async () => {
          const { AdminLayout } = await import('@/layouts/AdminLayout')
          return { Component: AdminLayout }
        },
        children: [
          { index: true, element: <Navigate to="reports" replace /> },
          page('reports', { title: '신고 처리', crumb: '신고 처리' }),
          page('reports/:reportId', { title: '신고 처리', crumb: '신고 처리' }),
          page('videos', { title: '해설 검수', crumb: '해설 검수' }),
          page('videos/:videoId', { title: '해설 검수', crumb: '해설 검수' }),
          page('users', { title: '회원' }),
        ],
      },
    ],
  },
]

export const routes: RouteObject[] = [
  {
    element: <RootProviders />,
    errorElement: <RootError />, // Provider 자체가 깨졌을 때
    HydrateFallback: () => null, // lazy 라우트로 첫 진입할 때 잠깐 그릴 것 (없음)
    children: [
      {
        errorElement: <RouteError />, // 화면 오류는 Provider 안쪽에서 처리 → 낭독·포커스 가능
        children: [
          { element: <RedirectIfAuthed />, children: publicRoutes },
          { element: <RequireAuth />, children: [...userRoutes, ...adminRoutes] },
          { element: <BareLayout />, children: [{ path: '*', element: <NotFoundPage /> }] },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(routes)