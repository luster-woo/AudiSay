import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { adminApi, type AdminUserListParams } from '@/api/admin'
import type { AdminUser, Paged } from '@/api/types'
import { renderRoute } from '@/test/renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/users', () => ({
  usersApi: { me: vi.fn(), settings: vi.fn(), updateSettings: vi.fn() },
}))
vi.mock('@/api/admin', () => ({
  adminApi: { reports: vi.fn(), users: vi.fn() },
}))

const user = (patch: Partial<AdminUser>): AdminUser => ({
  userId: 1,
  email: 'doyun.p@example.com',
  name: '박도윤',
  role: 'VISUALLY_IMPAIRED',
  verifiedAt: '2026-10-24T01:00:00Z',
  withdrawnAt: null,
  createdAt: '2026-10-24T00:50:00Z',
  ...patch,
})

const USERS = [
  user({}),
  user({
    userId: 2,
    name: '이서진',
    email: 'seojin@example.com',
    role: 'GENERAL',
    verifiedAt: null,
    createdAt: '2026-10-23T03:00:00Z',
  }),
  user({
    userId: 3,
    name: 'admin',
    email: 'admin@ssafy.com',
    role: 'ADMIN',
    verifiedAt: null,
    createdAt: '2026-10-22T03:00:00Z',
  }),
]

const paged = (
  content: AdminUser[],
  { total = content.length, number = 0, last = true } = {},
): Paged<AdminUser> => ({
  content,
  page: { number, size: 10, totalElements: total, totalPages: 1, first: number === 0, last },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reissueAccessToken).mockResolvedValue('t')
  vi.mocked(usersApi.me).mockResolvedValue({
    userId: 9,
    email: 'admin@audisay.kr',
    name: '정해린',
    role: 'ADMIN',
    verified: false,
    verifiedAt: null,
    createdAt: '2026-10-20T00:00:00Z',
  })
  vi.mocked(usersApi.settings).mockReturnValue(new Promise(() => {}))
  vi.mocked(adminApi.reports).mockResolvedValue({
    content: [],
    page: { number: 0, size: 1, totalElements: 0, totalPages: 0, first: true, last: true },
  })
  vi.mocked(adminApi.users).mockImplementation(async (p: AdminUserListParams) => {
    const list = USERS.filter(
      (u) => (!p.role || u.role === p.role) && (!p.keyword || u.email.includes(p.keyword)),
    )
    // 역할·검색어 없이 부르면 서버는 관리자까지 세어 129명 (관리자 1명)
    return paged(list, { total: p.role || p.keyword ? list.length : 129, last: false })
  })
})

describe('회원', () => {
  test('회원을 표로 보여 주고, 제목에 포커스를 둔다. 관리자는 줄과 인원수에서 뺀다', async () => {
    const { container } = renderRoute('/admin/users')

    const heading = await screen.findByRole('heading', { level: 1, name: '회원' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(adminApi.users).toHaveBeenCalledWith({ page: 0, size: 10 })
    expect(adminApi.users).toHaveBeenCalledWith({ role: 'ADMIN', size: 1 })
    expect(await screen.findByText('전체 128명')).toBeInTheDocument()
    expect(screen.queryByText('admin@ssafy.com')).not.toBeInTheDocument()
    // 회원 화면엔 위쪽 줄(현재 위치)이 없다 (Figma)
    expect(screen.queryByRole('navigation', { name: '현재 위치' })).not.toBeInTheDocument()

    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(3) // 머리 줄 + 2명
    expect(within(rows[1]).getByRole('rowheader', { name: '박도윤' })).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('시각장애인')
    expect(rows[2]).toHaveTextContent('인증 안 함')
    expect(screen.getByRole('navigation', { name: '페이지' })).toHaveTextContent('가입 최신순')

    expect(await axe(container)).toHaveNoViolations()
  })

  test('역할을 고르면 그 역할만 다시 불러오고 몇 명인지 알려 준다', async () => {
    renderRoute('/admin/users')
    await screen.findByText('전체 128명')

    // 관리자는 거르는 칸이 없다 (Figma)
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
      '전체',
      '일반',
      '시각장애인',
    ])
    await userEvent.click(screen.getByRole('radio', { name: '일반' }))

    expect(await screen.findByText('일반 1명')).toBeInTheDocument()
    expect(adminApi.users).toHaveBeenLastCalledWith({ role: 'GENERAL', page: 0, size: 10 })
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2)
    await waitFor(() => expect(screen.getByText('회원 1명을 찾았어요.')).toBeInTheDocument())
  })

  test('이메일로 찾고, 없으면 없다고 알려 준다', async () => {
    renderRoute('/admin/users')
    await screen.findByText('전체 128명')

    const box = screen.getByRole('searchbox', { name: '이메일 또는 이름' })
    await userEvent.type(box, '  nobody  ')
    await userEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(adminApi.users).toHaveBeenCalledWith({ keyword: 'nobody', page: 0, size: 10 })
    // 관리자 수도 같은 검색어로 센다
    expect(adminApi.users).toHaveBeenCalledWith({ role: 'ADMIN', keyword: 'nobody', size: 1 })
    expect(await screen.findByText('찾는 회원이 없어요.', { selector: 'p' })).toBeInTheDocument()
  })

  test('다음 쪽으로 넘기면 목록 제목으로 포커스를 옮긴다', async () => {
    renderRoute('/admin/users')
    await screen.findByText('전체 128명')

    await userEvent.click(screen.getByRole('button', { name: '다음 페이지' }))

    expect(adminApi.users).toHaveBeenLastCalledWith({ page: 1, size: 10 })
    expect(screen.getByRole('heading', { name: '회원 목록' })).toHaveFocus()
  })
})
