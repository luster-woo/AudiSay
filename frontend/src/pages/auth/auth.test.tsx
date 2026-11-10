import { screen, waitFor, within } from '@testing-library/react'
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
  test('제목에 포커스가 있고, 지금 시작하기는 로그인으로 간다', async () => {
    const { container } = renderRoute('/landing')
    const heading = await screen.findByRole('heading', { level: 1, name: /영상 화면해설/ })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(document.title).toBe('AudiSay - 시작하기')
    const start = screen.getByRole('link', { name: '지금 시작하기' })
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
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError('AUTH_001', 401, '이메일 또는 비밀번호가 맞지 않아요.'),
    )
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
    expect(screen.getByRole('checkbox', { name: /개인정보/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  test('약관 동의: 그룹·요약이 읽히고, 모두 동의가 둘을 켜고, 전문 창에서 동의하고 닫으면 체크된다', async () => {
    const { container } = renderRoute('/signup')
    const group = await screen.findByRole('group', { name: '약관 동의' })
    const terms = within(group).getByRole('checkbox', { name: '[필수] 이용약관에 동의해요' })
    const privacy = within(group).getByRole('checkbox', {
      name: '[필수] 개인정보 수집·이용에 동의해요',
    })
    const all = within(group).getByRole('checkbox', { name: '모두 동의해요' })
    expect(terms).toHaveAccessibleDescription(/AI가 영상에 화면 해설을 붙여 주는 서비스예요/)
    expect(privacy).not.toHaveAccessibleDescription()
    expect(within(group).queryByRole('button', { name: /개인정보/ })).not.toBeInTheDocument()

    await userEvent.click(all)
    expect(terms).toBeChecked()
    expect(privacy).toBeChecked()
    await userEvent.click(terms)
    expect(all).not.toBeChecked()
    expect(all).toBePartiallyChecked()

    // 전문 창: 제목에 포커스, 조항은 h3, 동의하고 닫기 → 체크 + 안내, 포커스는 전문 보기 버튼으로
    const view = within(group).getByRole('button', { name: '이용약관 전문 보기' })
    await userEvent.click(view)
    const dialog = await screen.findByRole('dialog', { name: 'AudiSay 이용약관' })
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveFocus()
    expect(within(dialog).getAllByRole('heading', { level: 3 })).toHaveLength(10)
    expect(within(dialog).queryByText(/조항 10개/)).not.toBeInTheDocument()
    expect(within(dialog).queryByText('요약')).not.toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()

    await userEvent.click(within(dialog).getByRole('button', { name: '동의하고 닫기' }))
    await waitFor(() => expect(dialog).not.toBeVisible())
    expect(terms).toBeChecked()
    expect(all).toBeChecked()
    expect(view).toHaveFocus()
    expect(screen.getByRole('region', { name: '방금 안내', hidden: true })).toHaveTextContent(
      '이용약관에 동의했어요.',
    )

    // 닫기만 하면 체크는 그대로 (Esc 는 브라우저가 cancel 로 같은 onClose 를 부른다. jsdom 은 cancel 을 내지 않음)
    await userEvent.click(terms)
    await userEvent.click(view)
    await waitFor(() => expect(dialog).toBeVisible())
    await userEvent.click(within(dialog).getAllByRole('button', { name: '닫기' })[0])
    await waitFor(() => expect(dialog).not.toBeVisible())
    expect(terms).not.toBeChecked()
    expect(privacy).toBeChecked()
    expect(view).toHaveFocus()
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
    await userEvent.click(screen.getByRole('checkbox', { name: '모두 동의해요' }))
    await userEvent.click(screen.getByRole('button', { name: '가입하기' }))

    // (startTransition) DOM 이 실제로 바뀔 때까지 기다린다
    expect(await screen.findByRole('region', { name: '가입했어요' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(authApi.signup).toHaveBeenCalledWith({
      name: '김하늘',
      email: 'a@b.co',
      password: 'pass1234!',
      termsAgreed: true,
    })
    expect(authApi.login).not.toHaveBeenCalled()
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

  test('서류가 거절되면 서버가 준 이유를 읽고, 파일을 비워 다시 고르게 한다', async () => {
    loggedIn()
    vi.mocked(usersApi.verify).mockRejectedValue(
      new ApiError(
        'USER_006',
        422,
        '서류의 글자를 읽지 못했어요. 글자가 잘 보이게 밝은 곳에서 다시 찍어 주세요.',
      ),
    )
    renderRoute('/verify')
    const input = await screen.findByLabelText('인증 서류 파일 고르기')
    expect(screen.getByText(/글자를 읽어 종류만 확인/)).toBeInTheDocument()
    await userEvent.upload(input, new File(['x'], '복지카드.jpg', { type: 'image/jpeg' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /민감정보/ }))
    await userEvent.click(screen.getByRole('button', { name: '인증 신청' }))

    expect(await screen.findByText('서류를 확인하지 못했어요')).toBeInTheDocument()
    expect(
      screen.getAllByText(/글자를 읽지 못했어요\. 글자가 잘 보이게 밝은 곳에서 다시 찍어 주세요\./)
        .length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/복지카드\.jpg/)).not.toBeInTheDocument()
    expect(input).toHaveFocus()
    expect(screen.getByRole('button', { name: '인증 신청' })).not.toHaveAttribute('aria-disabled')
  })

  test('하루 시도를 다 쓰면 서버 안내를 보여 주고 신청 버튼을 막는다', async () => {
    loggedIn()
    vi.mocked(usersApi.verify).mockRejectedValue(
      new ApiError(
        'USER_007',
        429,
        '오늘은 인증 신청을 더 할 수 없습니다. 내일 다시 시도해 주세요.',
      ),
    )
    renderRoute('/verify')
    await userEvent.upload(
      await screen.findByLabelText('인증 서류 파일 고르기'),
      new File(['x'], '복지카드.jpg', { type: 'image/jpeg' }),
    )
    await userEvent.click(screen.getByRole('checkbox', { name: /민감정보/ }))
    await userEvent.click(screen.getByRole('button', { name: '인증 신청' }))
    expect(await screen.findByText('오늘은 더 신청할 수 없어요')).toBeInTheDocument()
    expect(screen.getAllByText(/내일 다시 시도해 주세요/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '인증 신청' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  test('확인하는 동안은 버튼과 안내로 기다리라고 알린다', async () => {
    loggedIn()
    vi.mocked(usersApi.verify).mockReturnValue(new Promise(() => {}))
    renderRoute('/verify')
    await userEvent.upload(
      await screen.findByLabelText('인증 서류 파일 고르기'),
      new File(['x'], '복지카드.jpg', { type: 'image/jpeg' }),
    )
    await userEvent.click(screen.getByRole('checkbox', { name: /민감정보/ }))
    await userEvent.click(screen.getByRole('button', { name: '인증 신청' }))
    const busy = await screen.findByRole('button', { name: /서류를 확인하는 중/ })
    expect(screen.getByText('서류를 확인하고 있어요. 길면 1분쯤 걸려요.')).toBeInTheDocument()
    // 처리 중 표시는 잠깐 뒤부터 (짧은 요청이면 낭독기에 끼어들지 않도록)
    await waitFor(() => expect(busy).toHaveAttribute('aria-busy', 'true'), { timeout: 1500 })
  })

  test('이미 인증된 회원이 주소로 들어오면 내 정보로 보낸다 (기록에 남기지 않음)', async () => {
    loggedIn('VISUALLY_IMPAIRED')
    const { router } = renderRoute('/verify')
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.queryByRole('button', { name: '인증 신청' })).not.toBeInTheDocument()
  })
})
