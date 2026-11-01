import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { DEFAULT_SETTINGS } from '@/api/types'
import { renderRoute } from '@/test/renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/users', () => ({
  usersApi: { me: vi.fn(), settings: vi.fn(), updateSettings: vi.fn(), verify: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reissueAccessToken).mockResolvedValue('t')
  vi.mocked(usersApi.me).mockResolvedValue({
    userId: 1,
    email: 'a@b.co',
    name: '김하늘',
    role: 'VISUALLY_IMPAIRED',
    verified: true,
    verifiedAt: null,
    createdAt: '2026-10-20T00:00:00Z',
  })
  vi.mocked(usersApi.settings).mockResolvedValue({ ...DEFAULT_SETTINGS, tutorialCompleted: false })
  vi.mocked(usersApi.updateSettings).mockResolvedValue({
    ...DEFAULT_SETTINGS,
    tutorialCompleted: true,
  })
})

test('1단계: 제목에 포커스, 현재 단계 표시, Alt+Shift+R 연습', async () => {
  const { container } = renderRoute('/tutorial/1')
  const h1 = await screen.findByRole('heading', { level: 1, name: '둘러보기' })
  await waitFor(() => expect(h1).toHaveFocus())
  expect(screen.getByRole('link', { name: '1 둘러보기' })).toHaveAttribute('aria-current', 'step')
  expect(screen.getByText('아직 누르지 않았어요')).toBeInTheDocument()

  await userEvent.keyboard('{Alt>}{Shift>}R{/Shift}{/Alt}')
  expect(screen.getByText('Alt+Shift+R을 눌렀어요')).toBeInTheDocument()
  expect(await axe(container)).toHaveNoViolations()
})

test('다음 링크로 2단계, 잘못된 단계 번호는 1단계로', async () => {
  const { router } = renderRoute('/tutorial/9')
  await waitFor(() => expect(router.state.location.pathname).toBe('/tutorial/1'))
  await userEvent.click(await screen.findByRole('link', { name: '다음: 영상 찾기' }))
  expect(await screen.findByRole('heading', { level: 1, name: '영상 찾기' })).toBeInTheDocument()
})

test('2단계: 연습 검색은 실제로 검색하지 않고 해 봤다고 표시한다', async () => {
  renderRoute('/tutorial/2')
  await userEvent.type(await screen.findByRole('textbox', { name: '연습 검색어' }), '김치볶음밥')
  await userEvent.click(screen.getByRole('button', { name: '찾기' }))
  expect(screen.getByText('찾기를 눌렀어요')).toBeInTheDocument()
})

test('3단계: 재생을 누르면 버튼 이름이 일시정지로 바뀐다', async () => {
  renderRoute('/tutorial/3')
  await userEvent.click(await screen.findByRole('button', { name: '재생' }))
  expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument()
  expect(screen.getByText('재생해 봤어요')).toBeInTheDocument()
})

test('건너뛰면 사용법 완료를 저장하고 홈으로 간다', async () => {
  const { router } = renderRoute('/tutorial/2')
  await userEvent.click(await screen.findByRole('button', { name: '건너뛰고 시작하기' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(usersApi.updateSettings).toHaveBeenCalledWith({ tutorialCompleted: true })
})

test('4단계: 마지막 단계는 마치기 버튼과 처음부터 다시 듣기', async () => {
  renderRoute('/tutorial/4')
  expect(await screen.findByRole('button', { name: '사용법 마치고 시작하기' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '처음부터 다시 듣기' })).toHaveAttribute(
    'href',
    '/tutorial/1',
  )
})

test('4단계: Alt+Shift+Q 는 질문 칸으로 옮기고, 음성 인식이 없으면 글자로 적으라고 안내한다', async () => {
  const user = userEvent.setup()
  renderRoute('/tutorial/4')
  const input = await screen.findByRole('textbox', { name: '연습 질문' })
  await user.keyboard('{Alt>}{Shift>}Q{/Shift}{/Alt}')
  expect(input).toHaveFocus()
  // 안내 띠와 낭독 영역 두 곳에 같은 문장이 들어갈 수 있어 하나 이상이면 된다
  const msg = '이 브라우저에서는 말로 묻기를 쓸 수 없어요. 질문을 글자로 적어 주세요.'
  expect((await screen.findAllByText(msg)).length).toBeGreaterThan(0)
})
