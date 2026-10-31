import { screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { renderRoute } from './renderWithProviders'

// 쿠키가 없는 상태(비로그인)로 시작: 재발급 실패
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn().mockRejectedValue(new Error('no cookie')) }
})

test('로그인 화면이 레이아웃과 함께 렌더되고 접근성 위반이 없다', async () => {
  const { container } = renderRoute('/login')
  expect(await screen.findByRole('heading', { level: 1, name: '로그인' })).toBeInTheDocument()
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '본문으로 건너뛰기' })).toBeInTheDocument()
  expect(await axe(container)).toHaveNoViolations()
})