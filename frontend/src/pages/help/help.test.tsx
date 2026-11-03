import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { tokenStore } from '@/api/token'
import { DEFAULT_SETTINGS } from '@/api/types'
import { renderRoute } from '@/test/renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/users', () => ({ usersApi: { me: vi.fn(), settings: vi.fn() } }))

beforeEach(() => {
  vi.resetAllMocks()
  tokenStore.set('test-session')
  vi.mocked(reissueAccessToken).mockResolvedValue('test-session')
  vi.mocked(usersApi.me).mockResolvedValue({
    userId: 1,
    name: '테스트',
    email: 'test@example.com',
    role: 'GENERAL',
    verified: false,
    verifiedAt: null,
    createdAt: '2026-10-20T00:00:00Z',
  })
  vi.mocked(usersApi.settings).mockResolvedValue({ ...DEFAULT_SETTINGS, tutorialCompleted: true })
})

async function openTab(name: string) {
  await userEvent.click(await screen.findByRole('tab', { name }))
}

test('도움말에 진입하면 제목에 초점을 두고 네 단계 사용법으로 안내한다 (axe)', async () => {
  const { container } = renderRoute('/help')
  const heading = await screen.findByRole('heading', { level: 1, name: '도움말' })
  await waitFor(() => expect(heading).toHaveFocus())
  expect(document.title).toBe('도움말 – AudiSay')
  for (const [index, name] of ['둘러보기', '영상 찾기', '해설 들으며 보기', '질문하기'].entries()) {
    expect(screen.getByRole('link', { name: `${name} 사용법 듣기` })).toHaveAttribute(
      'href',
      `/tutorial/${index + 1}`,
    )
  }
  expect(await axe(container)).toHaveNoViolations()
})

test('상위 탭과 분류 탭을 화살표로 바꾸어도 초점이 제목으로 튀지 않는다', async () => {
  renderRoute('/help')
  const first = await screen.findByRole('tab', { name: '처음이라면' })
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  first.focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: '단축키' })).toHaveFocus()
  expect(screen.getByRole('tab', { name: '단축키' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(screen.getByRole('tab', { name: '어디서나' }))
  await userEvent.keyboard('{End}')
  const last = screen.getByRole('tab', { name: '질문과 설정' })
  expect(last).toHaveFocus()
  expect(screen.getByRole('table', { name: '질문과 설정 단축키' })).toBeVisible()
  await userEvent.keyboard('{Home}')
  expect(screen.getByRole('tab', { name: '어디서나' })).toHaveFocus()
})

test('어디서나 표는 현재 등록된 단축키와 일치하고 영상 키는 적용 위치를 설명한다 (axe)', async () => {
  const { container } = renderRoute('/help')
  await openTab('단축키')
  const table = screen.getByRole('table', { name: '어디서나 단축키' })
  expect(within(table).getAllByRole('row')).toHaveLength(4)
  await userEvent.keyboard('{Alt>}{Shift>}/{/Shift}{/Alt}')
  const dialog = screen.getByRole('dialog', { name: '단축키 안내' })
  for (const key of ['Alt+Shift+R', 'Alt+Shift+/', 'Alt+Shift+H']) {
    expect(within(table).getByText(key)).toBeVisible()
    expect(within(dialog).getByText(key)).toBeVisible()
  }
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  await openTab('재생과 이동')
  expect(screen.getByRole('table')).toHaveTextContent('재생 위치 슬라이더에서 설정한 간격만큼 이동')
  expect(await axe(container)).toHaveNoViolations()
  await openTab('질문과 설정')
  expect(screen.getByRole('table')).toHaveTextContent('Alt+Shift+S')
  expect(screen.getByRole('table')).toHaveTextContent('30초 요약 다시 듣기')
  expect(screen.queryByText('Alt+Shift+V')).not.toBeInTheDocument()
})

test('음성 안내는 실제 입력 순서와 세 분류의 명령 12개를 제공한다 (axe)', async () => {
  const { container } = renderRoute('/help')
  await openTab('말로 하는 명령')
  expect(screen.getByRole('heading', { name: '1. Alt+Shift+Q 누르기' })).toBeVisible()
  expect(screen.getByText('다 말하면 ‘말 끝내기’를 누르세요.')).toBeVisible()
  expect(screen.getByText('다르면 입력칸을 고쳐 ‘보내기’를 누르세요.')).toBeVisible()
  for (const category of ['재생 조절', '장면 찾기', '질문과 해설']) {
    await openTab(category)
    const table = screen.getByRole('table', { name: `${category} 음성 명령 예시` })
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['음성 명령', '설명'])
    expect(await axe(container)).toHaveNoViolations()
  }
  expect(screen.getByRole('link', { name: '질문하기 사용법 다시 듣기' })).toHaveAttribute(
    'href',
    '/tutorial/4',
  )
  expect(screen.queryByText(/아니.*말해/)).not.toBeInTheDocument()
})

test.each([
  ['단축키', '단축키가 작동하지 않을 때'],
  ['말로 하는 명령', '말을 알아듣지 못할 때'],
])('%s의 문제 해결 창이 열리고 닫힌 뒤 원래 버튼으로 돌아온다 (axe)', async (tab, title) => {
  const { container } = renderRoute('/help')
  await openTab(tab)
  const trigger = screen.getByRole('button', { name: title })
  await userEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: title })
  expect(within(dialog).getByRole('button', { name: '닫기' })).toHaveFocus()
  expect(await axe(container)).toHaveNoViolations()
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(trigger)
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '닫기' }))
  expect(trigger).toHaveFocus()
})

test('사용법 링크를 키보드로 열면 기존 튜토리얼로 이동한다', async () => {
  const { router } = renderRoute('/help')
  const link = await screen.findByRole('link', { name: '사용법 처음부터 듣기' })
  link.focus()
  await userEvent.keyboard('{Enter}')
  await waitFor(() => expect(router.state.location.pathname).toBe('/tutorial/1'))
})
