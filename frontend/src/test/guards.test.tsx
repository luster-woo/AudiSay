import { screen, waitFor, within } from '@testing-library/react'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import type { Me, Role } from '@/api/types'
import { renderRoute } from './renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/users', () => ({
  usersApi: { me: vi.fn(), settings: vi.fn(), updateSettings: vi.fn() },
}))

const reissue = vi.mocked(reissueAccessToken)
const me = vi.mocked(usersApi.me)
const settings = vi.mocked(usersApi.settings)

function loginAs(role: Role) {
  reissue.mockResolvedValue('token')
  me.mockResolvedValue({
    userId: 1,
    email: 'a@b.c',
    name: '김하늘',
    role,
    verified: role === 'VISUALLY_IMPAIRED',
    verifiedAt: null,
    createdAt: '2026-10-20T00:00:00Z',
  } satisfies Me)
  settings.mockReturnValue(new Promise(() => {})) // 설정 응답은 이 테스트와 무관
}
function anonymous() {
  reissue.mockRejectedValue(new Error('no cookie'))
}

beforeEach(() => vi.clearAllMocks())

test('비로그인으로 첫 화면(/)에 오면 랜딩으로 간다', async () => {
  anonymous()
  const { router } = renderRoute('/')
  await waitFor(() => expect(router.state.location.pathname).toBe('/landing'))
})

test('비로그인으로 관리자 주소에 오면 로그인으로 가고, 원래 주소를 기억한다', async () => {
  anonymous()
  const { router } = renderRoute('/admin/users')
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  expect(router.state.location.state).toEqual({ from: '/admin/users' })
})

test('일반 회원이 관리자 주소에 오면 홈으로 돌려보낸다', async () => {
  loginAs('GENERAL')
  const { router } = renderRoute('/admin/users')
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(await screen.findByRole('navigation', { name: '주 메뉴' })).toBeInTheDocument()
})

test('관리자가 로그인 화면에 오면 신고 처리로 보내고 사이드바를 그린다', async () => {
  loginAs('ADMIN')
  const { router } = renderRoute('/login')
  await waitFor(() => expect(router.state.location.pathname).toBe('/admin/reports'))
  expect(await screen.findByRole('navigation', { name: '운영 관리 메뉴' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '신고 처리' })).toHaveAttribute('aria-current', 'page')
  expect(document.documentElement.dataset.fontScale).toBe('2')
})

test('현재 메뉴에 aria-current 가 붙는다 (/verify → 내 정보)', async () => {
  loginAs('VISUALLY_IMPAIRED')
  renderRoute('/verify')
  const nav = within(await screen.findByRole('navigation', { name: '주 메뉴' }))
  expect(nav.getByRole('link', { name: '내 정보' })).toHaveAttribute('aria-current', 'page')
  expect(nav.getByRole('link', { name: '홈' })).not.toHaveAttribute('aria-current')
  expect(document.documentElement.dataset.fontScale).toBe('3')
})

test('없는 주소는 404 화면', async () => {
  anonymous()
  renderRoute('/no/such/page')
  expect(await screen.findByRole('heading', { name: '없는 페이지예요' })).toBeInTheDocument()
})
