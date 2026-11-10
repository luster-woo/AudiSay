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
  page: {
    number,
    size: 10,
    totalElements: total,
    totalPages: Math.max(1, Math.ceil(total / 10)),
    first: number === 0,
    last,
  },
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
    // 서버가 정렬한다 (가짜 서버도 같은 규칙으로)
    const sorted =
      p.sort === 'OLDEST'
        ? [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : p.sort === 'NAME'
          ? [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
          : list
    // 역할·검색어 없이 부르면 서버는 관리자까지 세어 129명
    return paged(sorted, {
      total: p.role || p.keyword ? list.length : 129,
      number: p.page ?? 0,
      last: false,
    })
  })
})

describe('회원', () => {
  test('회원을 표로 보여 주고, 제목에 포커스를 둔다. 관리자도 서버가 준 그대로 보인다', async () => {
    const { container } = renderRoute('/admin/users')

    const heading = await screen.findByRole('heading', { level: 1, name: '회원' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(adminApi.users).toHaveBeenCalledWith({ sort: 'NEWEST', page: 0, size: 10 })
    // 관리자 수를 따로 세어 빼지 않는다 (쪽 수가 서버와 달라 마지막 쪽 회원을 볼 수 없었다)
    expect(adminApi.users).not.toHaveBeenCalledWith(expect.objectContaining({ role: 'ADMIN' }))
    expect(await screen.findByRole('rowheader', { name: '박도윤' })).toBeInTheDocument()
    // 오른쪽 위 인원수 글자는 두지 않는다
    expect(screen.queryByText(/전체 \d+명/)).not.toBeInTheDocument()
    expect(screen.getByText('admin@ssafy.com')).toBeInTheDocument()
    // 회원 화면엔 위쪽 줄(현재 위치)이 없다 (Figma)
    expect(screen.queryByRole('navigation', { name: '현재 위치' })).not.toBeInTheDocument()

    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(4) // 머리 줄 + 3명(관리자 포함)
    expect(within(rows[1]).getByRole('rowheader', { name: '박도윤' })).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('시각장애인')
    expect(rows[2]).toHaveTextContent('인증 안 함')
    // 표 아래 가운데: 이전 · 쪽 번호(최대 5개) · 다음. '1–10 / 128명' 같은 글자는 없다
    const nav = screen.getByRole('navigation', { name: '페이지' })
    expect(
      within(nav)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['1', '2', '3', '4', '5'])
    expect(within(nav).getByRole('button', { name: '1쪽' })).toHaveAttribute('aria-current', 'page')
    expect(nav).not.toHaveTextContent('128명')
    expect(
      screen.queryByText('가입한 회원을 찾아봐요. 보기만 할 수 있어요.'),
    ).not.toBeInTheDocument()

    expect(await axe(container)).toHaveNoViolations()
  })

  test('역할을 고르면 그 역할만 다시 불러오고 몇 명인지 알려 준다', async () => {
    renderRoute('/admin/users')
    await screen.findByRole('rowheader', { name: '박도윤' })

    // 관리자는 거르는 칸이 없다 (Figma)
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
      '전체',
      '일반',
      '시각장애인',
    ])
    await userEvent.click(screen.getByRole('radio', { name: '일반' }))

    await waitFor(() =>
      expect(
        within(screen.getByRole('table'))
          .getAllByRole('rowheader')
          .map((c) => c.textContent),
      ).toEqual(['이서진']),
    )
    expect(adminApi.users).toHaveBeenLastCalledWith({
      role: 'GENERAL',
      sort: 'NEWEST',
      page: 0,
      size: 10,
    })
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2)
    await waitFor(() => expect(screen.getByText('회원 1명을 찾았어요.')).toBeInTheDocument())
  })

  test('이메일로 찾고, 없으면 없다고 알려 준다', async () => {
    renderRoute('/admin/users')
    await screen.findByRole('rowheader', { name: '박도윤' })

    const box = screen.getByRole('searchbox', { name: '이메일 또는 이름' })
    await userEvent.type(box, '  nobody  ')
    await userEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(adminApi.users).toHaveBeenCalledWith({
      keyword: 'nobody',
      sort: 'NEWEST',
      page: 0,
      size: 10,
    })
    expect(await screen.findByText('찾는 회원이 없어요.', { selector: 'p' })).toBeInTheDocument()
  })

  test('다음 쪽으로 넘기면 목록 제목으로 포커스를 옮긴다', async () => {
    renderRoute('/admin/users')
    await screen.findByRole('rowheader', { name: '박도윤' })

    await userEvent.click(screen.getByRole('button', { name: '다음 페이지' }))

    expect(adminApi.users).toHaveBeenLastCalledWith({ sort: 'NEWEST', page: 1, size: 10 })
    expect(screen.getByRole('heading', { name: '회원 목록' })).toHaveFocus()
  })

  test('쪽 번호는 5개씩: 5쪽에서 다음을 누르면 6~10쪽 번호가 보이고, 번호를 눌러 옮길 수 있다', async () => {
    renderRoute('/admin/users')
    await screen.findByRole('rowheader', { name: '박도윤' })
    const nav = () => screen.getByRole('navigation', { name: '페이지' })

    await userEvent.click(within(nav()).getByRole('button', { name: '5쪽' }))
    expect(adminApi.users).toHaveBeenLastCalledWith({ sort: 'NEWEST', page: 4, size: 10 })
    await userEvent.click(within(nav()).getByRole('button', { name: '다음 페이지' }))
    expect(adminApi.users).toHaveBeenLastCalledWith({ sort: 'NEWEST', page: 5, size: 10 })
    // 129명 / 10명 = 13쪽 → 6~10 묶음
    await waitFor(() =>
      expect(
        within(nav())
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual(['6', '7', '8', '9', '10']),
    )
    expect(within(nav()).getByRole('button', { name: '6쪽' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('정렬을 고르면 서버에 정렬을 맡겨 그 쪽만 받는다. 포커스는 정렬 칸에 그대로', async () => {
    renderRoute('/admin/users')
    await screen.findByRole('rowheader', { name: '박도윤' })

    const sort = screen.getByRole('combobox', { name: '정렬' })
    expect(
      within(sort)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['기본', '가입일(최신 순)', '가입일(오래된 순)', '이름(가나다순)'])

    await userEvent.selectOptions(sort, '가입일(오래된 순)')
    expect(adminApi.users).toHaveBeenCalledWith({ sort: 'OLDEST', page: 0, size: 10 })
    expect(adminApi.users).not.toHaveBeenCalledWith(expect.objectContaining({ size: 50 }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('table'))
          .getAllByRole('rowheader')
          .map((c) => c.textContent),
      ).toEqual(['admin', '이서진', '박도윤']),
    )
    expect(sort).toHaveFocus()
    expect(screen.getByRole('heading', { level: 1, name: '회원' })).not.toHaveFocus()

    await userEvent.selectOptions(sort, '이름(가나다순)')
    await waitFor(() =>
      expect(
        within(screen.getByRole('table'))
          .getAllByRole('rowheader')
          .map((c) => c.textContent),
      ).toEqual(['박도윤', '이서진', 'admin']),
    )
  })
})

describe('AdminPagination', () => {
  test('6쪽까지 있을 때 6쪽에 오면 번호는 6 하나만 보인다', async () => {
    const { render } = await import('@testing-library/react')
    const { AdminPagination } = await import('@/features/admin/AdminPagination')
    render(<AdminPagination page={5} totalPages={6} onChange={() => {}} />)
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['6'])
    expect(screen.getByRole('button', { name: '다음 페이지' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})
