import type { ComponentType } from 'react'
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
import LandingPage from '@/pages/auth/LandingPage'
import LoginPage from '@/pages/auth/LoginPage'
import SignupPage from '@/pages/auth/SignupPage'
import VerifyPage from '@/pages/auth/VerifyPage'
import TutorialPage from '@/pages/tutorial/TutorialPage'
import HomePage from '@/pages/home/HomePage'
import SearchPage from '@/pages/home/SearchPage'
import YoutubeCheckPage from '@/pages/home/YoutubeCheckPage'
import RegisterPage from '@/pages/register/RegisterPage'
import JobPage from '@/pages/jobs/JobPage'
import NotFoundPage from '@/pages/errors/NotFoundPage'
import RouteError from '@/pages/errors/RouteError'
import RootError from '@/pages/errors/RootError'

/** 임시 페이지 라우트. 실제 페이지를 만들면 element 를 바꾼다 */
const page = (path: string, handle: RouteHandle): RouteObject => ({
  path,
  element: <PlaceholderPage />,
  handle,
})

/** 관리자 페이지 라우트. 페이지도 lazy 로 불러와 일반 사용자 번들에 섞이지 않게 한다 */
const adminPage = (
  path: string,
  handle: RouteHandle,
  load: () => Promise<{ default: ComponentType }>,
): RouteObject => ({
  path,
  handle,
  lazy: async () => ({ Component: (await load()).default }),
})
const reportsPage = () => import('@/pages/admin/ReportsPage')

/** 로그인 전에만 보는 화면 (로그인 상태면 RedirectIfAuthed 가 돌려보낸다) */
const publicRoutes: RouteObject[] = [
  {
    element: <BareLayout />,
    children: [{ path: 'landing', element: <LandingPage /> }],
  },
  {
    element: <AuthLayout />,
    children: [
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignupPage /> },
    ],
  },
]

/** 로그인한 사용자 화면 (헤더 + 주 메뉴 + 방금 안내 띠) */
const userRoutes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'search/youtube', element: <YoutubeCheckPage /> },
      { path: 'register', element: <RegisterPage /> },
      // 업로드 단계는 한 화면(/register) 안에서 바뀐다. 예전 주소는 처음 단계로 보낸다
      { path: 'register/*', element: <Navigate to="/register" replace /> },
      { path: 'upload/*', element: <Navigate to="/register" replace /> },
      { path: 'jobs/:jobId', element: <JobPage /> },
      page('watch/:videoId', { title: '영상 보기' }),
      { path: 'tutorial/:step', element: <TutorialPage /> },
      { path: 'verify', element: <VerifyPage /> },
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
          adminPage('reports', { title: '신고 처리', crumb: '신고 처리' }, reportsPage),
          adminPage('reports/:reportId', { title: '신고 처리', crumb: '신고 처리' }, reportsPage),
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
