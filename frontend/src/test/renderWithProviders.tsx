import type { ReactElement } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { RootProviders } from '@/app/providers'
import { routes } from '@/app/router'

interface Options extends Omit<RenderOptions, 'wrapper'> {
  /** 테스트 시작 경로 */
  route?: string
}

function testQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

/** 컴포넌트 하나를 실제 앱과 같은 Provider 구성 안에서 렌더한다 (레이아웃·가드 없음) */
export function renderWithProviders(ui: ReactElement, { route = '/', ...options }: Options = {}) {
  const queryClient = testQueryClient()
  const router = createMemoryRouter(
    [{ element: <RootProviders />, children: [{ path: '*', element: ui }] }],
    { initialEntries: [route] },
  )
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
      options,
    ),
    router,
    queryClient,
  }
}

/** 실제 라우트 전체(가드·레이아웃 포함)를 특정 주소에서 시작해 렌더한다 */
export function renderRoute(route: string, options: Omit<RenderOptions, 'wrapper'> = {}) {
  const queryClient = testQueryClient()
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
      options,
    ),
    router,
    queryClient,
  }
}