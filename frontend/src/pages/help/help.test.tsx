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

test('단축키로 진입하고 튜토리얼은 두 탭 뒤의 이동 링크로 제공한다 (axe)', async () => {
  const { container } = renderRoute('/help')
  const heading = await screen.findByRole('heading', { level: 1, name: '도움말' })
  await waitFor(() => expect(heading).toHaveFocus())
  expect(document.title).toBe('AudiSay - 도움말')
  const navigation = screen.getByRole('tablist', { name: '도움말 종류' })
  expect(
    within(navigation)
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['단축키', '말로 하는 명령'])
  expect(within(navigation).getByRole('tab', { name: '단축키' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(screen.queryByRole('tab', { name: '처음이라면' })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: '단축키가 작동하지 않을 때' }),
  ).not.toBeInTheDocument()
  const tutorial = screen.getByRole('link', { name: '튜토리얼 이동' })
  expect(tutorial).toHaveAttribute('href', '/tutorial/1')
  expect(
    navigation.compareDocumentPosition(tutorial) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  expect(await axe(container)).toHaveNoViolations()
})

test('상위 탭을 화살표로 바꾸어도 초점이 제목으로 튀지 않는다', async () => {
  renderRoute('/help')
  const first = await screen.findByRole('tab', { name: '단축키' })
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  first.focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: '말로 하는 명령' })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  expect(screen.getByRole('link', { name: '튜토리얼 이동' })).toHaveFocus()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}{ArrowLeft}')
  expect(screen.getByRole('tab', { name: '단축키' })).toHaveFocus()
})

test('단축키는 분류 탭 없이 어디서나 3개, 영상 찾을 때 1개, 영상 볼 때 8개를 한 화면에 보여 준다 (axe)', async () => {
  const { container } = renderRoute('/help')
  await openTab('단축키')
  expect(screen.queryByRole('tab', { name: '어디서나' })).not.toBeInTheDocument()
  const everywhere = screen.getByRole('list', { name: '어디서나' })
  const watch = screen.getByRole('list', { name: '영상 볼 때' })
  expect(within(everywhere).getAllByRole('listitem')).toHaveLength(3)
  expect(within(watch).getAllByRole('listitem')).toHaveLength(8)
  for (const key of ['H', 'R', '/']) expect(within(everywhere).getByText(key)).toBeVisible()
  for (const key of ['K', 'J', 'L', 'P', 'D', '1', '2', '3', 'Q', 'S', 'X']) {
    expect(within(watch).getByText(key)).toBeVisible()
  }
  expect(watch).toHaveTextContent('재생 설정 열기')
  expect(watch).toHaveTextContent('지금 해설 문장 신고')
  // 뺀 키는 보이지 않는다
  for (const key of ['U', 'V', 'C', 'N', 'G', 'F']) {
    expect(within(container).queryByText(key)).not.toBeInTheDocument()
  }
  expect(
    within(screen.getByRole('list', { name: '영상 찾을 때' })).getAllByRole('listitem'),
  ).toHaveLength(1)
  // 도움말 화면의 안내 창에는 어디서나 쓰는 3개만 나온다
  await userEvent.keyboard('{Alt>}{Shift>}/{/Shift}{/Alt}')
  const dialog = screen.getByRole('dialog', { name: '단축키 안내' })
  expect(within(dialog).queryByRole('list', { name: '이 화면에서' })).not.toBeInTheDocument()
  const anywhere = within(dialog).getByRole('list', { name: '어디서나' })
  expect(
    within(anywhere)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.shortcut-dialog-desc')?.textContent),
  ).toEqual(['홈으로 가기', '방금 안내 다시 듣기', '지금 화면의 단축키 보기'])
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  expect(await axe(container)).toHaveNoViolations()
})

test('음성 안내는 와이어프레임의 3단계 설명과 명령 16개(홈 음성 검색 포함)를 제공한다 (axe)', async () => {
  const { container } = renderRoute('/help')
  await openTab('말로 하는 명령')
  expect(
    screen.getByRole('heading', {
      name: '일 단계. 알트와 시프트를 누른 상태에서 큐 키를 누르세요.',
    }),
  ).toBeVisible()
  expect(screen.getByText('원하는 요청을 말해 주세요.')).toBeVisible()
  expect(screen.getByText('내용이 틀리면 ‘아니’라고 말해 주세요.')).toBeVisible()
  expect(screen.queryByRole('button', { name: '말을 알아듣지 못할 때' })).not.toBeInTheDocument()
  for (const category of ['재생 조절', '장면 찾기', '질문과 해설', '홈 음성 검색']) {
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
  await openTab('질문과 해설')
  expect(screen.getByRole('table')).toHaveTextContent('‘여기 신고’')
  expect(screen.getByRole('table')).toHaveTextContent('현재 재생 위치와 남은 시간')
})

test('사용법 링크를 키보드로 열면 기존 튜토리얼로 이동한다', async () => {
  const { router } = renderRoute('/help')
  const link = await screen.findByRole('link', { name: '튜토리얼 이동' })
  link.focus()
  await userEvent.keyboard('{Enter}')
  await waitFor(() => expect(router.state.location.pathname).toBe('/tutorial/1'))
})

test('표시는 유지하면서 단축키와 안내를 기호 대신 한국어 문장으로 제공한다', async () => {
  renderRoute('/help')
  await openTab('단축키')
  expect(
    screen.getByText('Alt+Shift+/를 누르면 지금 화면에서 쓸 수 있는 단축키를 알려 드려요.'),
  ).toHaveAttribute('aria-hidden', 'true')
  const home = within(screen.getByRole('list', { name: '어디서나' })).getAllByRole('listitem')[0]
  expect(home).toHaveTextContent('알트와 시프트를 누른 상태에서 에이치 키를 누르세요.')
  expect(within(home).getByText('H').closest('[aria-hidden="true"]')).not.toBeNull()

  for (const name of ['어디서나', '영상 찾을 때', '영상 볼 때']) {
    for (const item of within(screen.getByRole('list', { name })).getAllByRole('listitem')) {
      const spoken = [...item.querySelectorAll('.sr-only')].map((el) => el.textContent)
      expect(spoken[0]).toMatch(/^알트와 시프트를 누른 상태에서 [가-힣 ]+ 키를 누르세요\.$/)
      for (const text of spoken) expect(text).not.toMatch(/[+/~·]/)
      const desc = item.querySelector('.help-shortcut-desc')!
      const readable = [...desc.childNodes]
        .filter((n) => !(n instanceof HTMLElement && n.getAttribute('aria-hidden') === 'true'))
        .map((n) => n.textContent)
        .join('')
      expect(readable).not.toMatch(/[+/~·]/)
    }
  }
})

test('음성 입력 단계와 모든 음성 명령 표는 따옴표와 슬래시를 중복 낭독하지 않는다', async () => {
  renderRoute('/help')
  await openTab('말로 하는 명령')
  expect(screen.getByText('① Alt+Shift+Q 누르기')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByRole('heading', { name: '이 단계. 띵 소리가 나면 말하세요.' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '삼 단계. 들은 내용을 확인하세요.' })).toBeVisible()
  expect(screen.getByText('내용이 틀리면 ‘아니’라고 말해 주세요.')).toHaveAttribute(
    'aria-hidden',
    'true',
  )

  const playback = screen.getByRole('table')
  expect(
    within(playback).getByRole('rowheader', {
      name: '멈춰 또는 다시 틀어라고 말하세요.',
    }),
  ).toBeVisible()
  expect(
    within(playback).getByRole('cell', {
      name: '조금 느리게는 영 점 칠오 배속이에요. 보통으로는 기본 속도예요.',
    }),
  ).toBeVisible()
  expect(within(playback).getByText('0.75배속 / 기본 속도')).toBeVisible()

  for (const category of ['재생 조절', '장면 찾기', '질문과 해설', '홈 음성 검색']) {
    await openTab(category)
    const table = screen.getByRole('table')
    for (const cell of [
      ...within(table).getAllByRole('rowheader'),
      ...within(table).getAllByRole('cell'),
    ]) {
      expect(cell).not.toHaveAccessibleName(/[‘’/+·?]/)
    }
  }
})
