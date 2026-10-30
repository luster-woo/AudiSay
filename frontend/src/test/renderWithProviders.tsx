import type { ReactElement } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { RootProviders } from '@/app/providers'

interface Options extends Omit<RenderOptions, 'wrapper'> {
  /** 테스트 시작 경로 */
  route?: string
}

/** 실제 앱과 같은 Provider 구성(QueryClient → Router → RootProviders) 안에서 렌더한다 */
export function renderWithProviders(ui: ReactElement, { route = '/', ...options }: Options = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
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