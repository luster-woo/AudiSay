import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { DEFAULT_SETTINGS } from '@/api/types'
import { renderRoute } from '@/test/renderWithProviders'
import { SHOT_HEIGHT, SHOT_WIDTH, TUTORIAL_STEPS } from './steps'

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

test('1단계: 제목에 포커스, 현재 단계 표시, 예시 화면은 낭독기에 숨긴다', async () => {
  const { container } = renderRoute('/tutorial/1')
  const h1 = await screen.findByRole('heading', { level: 1, name: '영상 불러오기' })
  await waitFor(() => expect(h1).toHaveFocus())
  expect(screen.getByText(`${TUTORIAL_STEPS.length}단계 중 1단계, 홈 화면`)).toBeInTheDocument()
  // 단계 목록 링크는 없다 (이전·다음으로만 오간다)
  expect(screen.queryByRole('link', { name: /^1 / })).toBeNull()
  expect(
    screen.getByText(
      '유튜브 링크를 입력하거나 영상을 직접 업로드해 보세요. AI가 영상 내용을 분석해 드립니다.',
    ),
  ).toBeInTheDocument()

  const stage = screen.getByTestId('tutorial-stage')
  expect(stage).toHaveAttribute('aria-hidden', 'true')
  expect(stage.querySelector('img')).toHaveAttribute('src', TUTORIAL_STEPS[0].screen.image)
  expect(await axe(container)).toHaveNoViolations()
})

test('강조 영역은 모두 예시 화면 안에 있고, 같은 화면이 이어지면 그림은 그대로 두고 강조만 옮긴다', async () => {
  for (const s of TUTORIAL_STEPS) {
    const { x, y, w, h } = s.target
    expect(x >= 0 && y >= 0 && w > 0 && h > 0).toBe(true)
    expect(x + w <= SHOT_WIDTH && y + h <= SHOT_HEIGHT).toBe(true)
  }
  const { router } = renderRoute('/tutorial/1')
  await screen.findByRole('heading', { level: 1, name: TUTORIAL_STEPS[0].title })
  const img = screen.getByTestId('tutorial-stage').querySelector('img')
  const before = screen.getByTestId('tutorial-highlight').style.top
  await router.navigate('/tutorial/2')
  await screen.findByRole('heading', { level: 1, name: TUTORIAL_STEPS[1].title })
  expect(TUTORIAL_STEPS[1].screen).toBe(TUTORIAL_STEPS[0].screen)
  expect(screen.getByTestId('tutorial-stage').querySelector('img')).toBe(img)
  expect(screen.getByTestId('tutorial-highlight').style.top).not.toBe(before)
})

test('버튼은 이전·다음으로 통일: 첫 단계의 이전은 누를 수 없고, 다음·이전으로 오간다', async () => {
  const user = userEvent.setup()
  const { router } = renderRoute('/tutorial/9')
  // 주소로 단계를 바로 연다
  await waitFor(() => expect(router.state.location.pathname).toBe('/tutorial/9'))
  await screen.findByRole('heading', { level: 1, name: TUTORIAL_STEPS[8].title })

  // 없는 단계 번호는 1단계로
  await router.navigate('/tutorial/99')
  await waitFor(() => expect(router.state.location.pathname).toBe('/tutorial/1'))
  expect(await screen.findByRole('button', { name: '이전' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )

  await user.click(screen.getByRole('link', { name: '다음' }))
  expect(
    await screen.findByRole('heading', { level: 1, name: TUTORIAL_STEPS[1].title }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('link', { name: '이전' }))
  expect(
    await screen.findByRole('heading', { level: 1, name: '영상 불러오기' }),
  ).toBeInTheDocument()
})

test('마지막 단계의 다음은 완료를 저장하고 홈으로 간다', async () => {
  const user = userEvent.setup()
  const { router } = renderRoute(`/tutorial/${TUTORIAL_STEPS.length}`)
  await screen.findByRole('heading', { level: 1, name: '자유롭게 영상 즐기기' })
  await user.click(screen.getByRole('button', { name: '다음' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(usersApi.updateSettings).toHaveBeenCalledWith({ tutorialCompleted: true })
})

test('건너뛰기도 완료를 저장하고 홈으로 간다', async () => {
  const user = userEvent.setup()
  const { router } = renderRoute('/tutorial/3')
  await user.click(await screen.findByRole('button', { name: '건너뛰기' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(usersApi.updateSettings).toHaveBeenCalledWith({ tutorialCompleted: true })
})
