import { screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { renderWithProviders } from './renderWithProviders'
import App from '@/App'

// AuthProvider 가 시작 시 호출하는 재발급을 막는다: 쿠키가 없는 상태(비로그인)로 시작
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn().mockRejectedValue(new Error('no cookie')) }
})

test('앱이 렌더되고 접근성 위반이 없다', async () => {
  const { container } = renderWithProviders(<App />)
  // status 가 loading → anonymous 로 바뀐 뒤에야 <main> 이 그려진다
  expect(await screen.findByRole('main')).toBeInTheDocument()
  expect(await axe(container)).toHaveNoViolations()
})