import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { authApi } from '@/api/auth'
import { usersApi } from '@/api/users'
import { ApiError } from '@/api/errors'
import { DEFAULT_SETTINGS, type LoginResult, type Me } from '@/api/types'
import { renderRoute } from '@/test/renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/auth', () => ({
  authApi: { login: vi.fn(), logout: vi.fn(), signup: vi.fn(), checkEmail: vi.fn() },
}))
vi.mock('@/api/users', () => ({
  usersApi: { me: vi.fn(), settings: vi.fn(), updateSettings: vi.fn(), verify: vi.fn() },
}))

const user = (role: Me['role'] = 'GENERAL', tutorialCompleted = true): LoginResult['user'] => ({
  userId: 1,
  email: 'haneul@example.com',
  name: '김하늘',
  role,
  tutorialCompleted,
})
const loginResult = (u = user()): LoginResult => ({
  accessToken: 't',
  tokenType: 'Bearer',
  expiresIn: 3600,
  user: u,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reissueAccessToken).mockRejectedValue(new Error('no cookie'))
  vi.mocked(usersApi.settings).mockReturnValue(new Promise(() => {}))
})

/** 로그인 직후 부르는 재생 설정 응답 */
const settingsWith = (tutorialCompleted: boolean) =>
  vi.mocked(usersApi.settings).mockResolvedValue({ ...DEFAULT_SETTINGS, tutorialCompleted })

async function submitLogin() {
  await userEvent.type(await screen.findByRole('textbox', { name: '이메일' }), 'haneul@example.com')
  await userEvent.type(screen.getByLabelText('비밀번호'), 'pass1234!')
  await userEvent.click(screen.getByRole('button', { name: '로그인' }))
}

describe('랜딩', () => {
  test('지금 시작하기에 포커스가 있고 로그인으로 간다', async () => {
    const { container } = renderRoute('/landing')
    const start = await screen.findByRole('link', { name: '지금 시작하기' })
    await waitFor(() => expect(start).toHaveFocus())
    expect(start).toHaveAttribute('href', '/login')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('로그인', () => {
  test('빈 칸으로 누르면 이메일 칸으로 포커스가 가고 오류가 읽힌다', async () => {
    renderRoute('/login')
    await userEvent.click(await screen.findByRole('button', { name: '로그인' }))
    const email = screen.getByRole('textbox', { name: '이메일' })
    expect(email).toHaveFocus()
    expect(email).toHaveAccessibleDescription('이메일을 입력해 주세요.')
    expect(authApi.login).not.toHaveBeenCalled()
  })

  test('비밀번호가 틀리면 비밀번호 칸을 비우고 그 칸으로 옮긴다 (와이어프레임 login · 오류)', async () => {
    vi.mocked(authApi.login).mockRejectedValue(new ApiError('AUTH_001', 401, ''))
    renderRoute('/login')
    await userEvent.type(
      await screen.findByRole('textbox', { name: '이메일' }),
      'haneul@example.com',
    )
    await userEvent.type(screen.getByLabelText('비밀번호'), 'wrong-pass1!')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    const pw = await screen.findByLabelText('비밀번호')
    await waitFor(() => expect(pw).toHaveFocus())
    expect(pw).toHaveValue('')
    expect(pw).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('region', { name: '로그인하지 못했어요' })).toHaveTextContent(
      '비밀번호 칸으로 옮겼어요',
    )
  })

  test('처음 로그인하면 사용법 1단계로 간다', async () => {
    vi.mocked(authApi.login).mockResolvedValue(loginResult(user('GENERAL', false)))
    const { router } = renderRoute('/login')
    await submitLogin()
    await waitFor(() => expect(router.state.location.pathname).toBe('/tutorial/1'))
  })

  test('로그인 응답에 tutorialCompleted 가 없으면 설정 값으로 판단한다 (false → 사용법)', async () => {
    const noFlag: Partial<LoginResult['user']> = user('VISUALLY_IMPAIRED')
    delete noFlag.tutorialCompleted
    vi.mocked(authApi.login).mockResolvedValue(loginResult(noFlag as LoginResult['user']))
    settingsWith(false)
    const { router } = renderRoute('/login')
    await submitLogin()
    await waitFor(() => expect(router.state.location.pathname).toBe('/tutorial/1'))
    expect(usersApi.settings).toHaveBeenCalled()
  })

  test('로그인 응답에 tutorialCompleted 가 없고 설정이 true 면 홈으로 간다', async () => {
    const noFlag: Partial<LoginResult['user']> = user('GENERAL')
    delete noFlag.tutorialCompleted
    vi.mocked(authApi.login).mockResolvedValue(loginResult(noFlag as LoginResult['user']))
    settingsWith(true)
    const { router } = renderRoute('/login')
    await submitLogin()
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  test('로그인 응답 값이 1순위: 응답이 true 면 설정이 false 여도 홈으로 간다', async () => {
    vi.mocked(authApi.login).mockResolvedValue(loginResult(user('GENERAL', true)))
    settingsWith(false)
    const { router } = renderRoute('/login')
    await submitLogin()
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  test('로그인 응답이 false 면 설정을 기다리지 않고 사용법으로 간다', async () => {
    vi.mocked(authApi.login).mockResolvedValue(loginResult(user('GENERAL', false)))
    // 설정 응답이 오지 않아도 (beforeEach: 끝나지 않는 요청) 바로 이동해야 한다
    const { router } = renderRoute('/login')
    await submitLogin()
    await waitFor(() => expect(router.state.location.pathname).toBe('/tutorial/1'))
  })

  test('응답에 값이 없고 설정도 못 받으면 홈으로 간다', async () => {
    const noFlag: Partial<LoginResult['user']> = user('GENERAL')
    delete noFlag.tutorialCompleted
    vi.mocked(authApi.login).mockResolvedValue(loginResult(noFlag as LoginResult['user']))
    vi.mocked(usersApi.settings).mockRejectedValue(new Error('network'))
    const { router } = renderRoute('/login')
    await submitLogin()
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  test('관리자는 사용법 여부와 상관없이 신고 처리로 간다', async () => {
    vi.mocked(authApi.login).mockResolvedValue(loginResult(user('ADMIN', false)))
    const { router } = renderRoute('/login')
    await submitLogin()
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/reports'))
  })
})

describe('회원가입', () => {
  test('규칙에 맞지 않는 칸을 모두 표시하고 첫 칸으로 옮긴다', async () => {
    renderRoute('/signup')
    await userEvent.click(await screen.findByRole('button', { name: '가입하기' }))
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveFocus()
    expect(screen.getByRole('region', { name: '가입하지 못했어요' })).toHaveTextContent(
      '5개 칸을 확인해 주세요.',
    )
    expect(screen.getByRole('checkbox', { name: /이용약관/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  test('이메일 칸을 벗어나면 사용 가능 여부를 알려 준다', async () => {
    vi.mocked(authApi.checkEmail).mockResolvedValue({ email: 'a@b.co', available: true })
    renderRoute('/signup')
    await userEvent.type(await screen.findByRole('textbox', { name: '이메일' }), 'a@b.co')
    await userEvent.tab()
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: '이메일' })).toHaveAccessibleDescription(
        '사용할 수 있는 이메일이에요.',
      ),
    )
  })

  test('가입하면 로그인하지 않고 로그인 화면으로 간다 (이메일을 채우고 비밀번호 칸으로)', async () => {
    vi.mocked(authApi.checkEmail).mockResolvedValue({ email: 'a@b.co', available: true })
    vi.mocked(authApi.signup).mockResolvedValue({
      userId: 1,
      email: 'a@b.co',
      name: '김하늘',
      role: 'GENERAL',
    })
    const { router } = renderRoute('/signup')

    await userEvent.type(await screen.findByRole('textbox', { name: '이름' }), '김하늘')
    await userEvent.type(screen.getByRole('textbox', { name: '이메일' }), 'a@b.co')
    await userEvent.type(screen.getAllByLabelText(/비밀번호/)[0], 'pass1234!')
    await userEvent.type(screen.getByLabelText(/^비밀번호 확인/), 'pass1234!')
    await userEvent.click(screen.getByRole('checkbox', { name: /이용약관/ }))
    await userEvent.click(screen.getByRole('button', { name: '가입하기' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(authApi.signup).toHaveBeenCalledWith({
      name: '김하늘',
      email: 'a@b.co',
      password: 'pass1234!',
      termsAgreed: true,
    })
    expect(authApi.login).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: '가입했어요' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '이메일' })).toHaveValue('a@b.co')
    await waitFor(() => expect(screen.getByLabelText('비밀번호')).toHaveFocus())
  })
})

describe('시각장애인 인증', () => {
  function loggedIn(role: Me['role'] = 'GENERAL') {
    vi.mocked(reissueAccessToken).mockResolvedValue('t')
    vi.mocked(usersApi.me).mockResolvedValue({
      ...user(role),
      verified: role === 'VISUALLY_IMPAIRED',
      verifiedAt: null,
      createdAt: '2026-10-20T00:00:00Z',
    })
  }

  test('잘못된 형식의 파일은 고르자마자 알려 준다', async () => {
    loggedIn()
    renderRoute('/verify')
    const input = await screen.findByLabelText('인증 서류 파일 고르기')
    await userEvent.upload(input, new File(['x'], 'memo.txt', { type: 'text/plain' }), {
      applyAccept: false,
    })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('PDF, JPG, PNG 파일만 올릴 수 있어요.')).toBeInTheDocument()
  })

  test('서류와 동의가 있으면 인증하고 완료 화면을 보여 준다', async () => {
    loggedIn()
    vi.mocked(usersApi.verify).mockResolvedValue({
      role: 'VISUALLY_IMPAIRED',
      verifiedAt: '2026-10-31T00:00:00Z',
      accessToken: 'new-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
    })
    renderRoute('/verify')
    await userEvent.upload(
      await screen.findByLabelText('인증 서류 파일 고르기'),
      new File(['x'], '복지카드.jpg', { type: 'image/jpeg' }),
    )
    await userEvent.click(screen.getByRole('checkbox', { name: /민감정보/ }))
    await userEvent.click(screen.getByRole('button', { name: '인증 신청' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: '인증이 끝났어요' }),
    ).toBeInTheDocument()
    expect(usersApi.verify).toHaveBeenCalledOnce()
  })

  test('이미 인증된 회원은 신청 양식이 없다', async () => {
    loggedIn('VISUALLY_IMPAIRED')
    renderRoute('/verify')
    expect(await screen.findByText(/이미 인증된 회원이에요/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '인증 신청' })).not.toBeInTheDocument()
  })
})
