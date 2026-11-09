import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { authApi } from '@/api/auth'
import { usersApi } from '@/api/users'
import { tokenStore } from '@/api/token'
import { ApiError } from '@/api/errors'
import { DEFAULT_SETTINGS, type Me } from '@/api/types'
import { queryKeys } from '@/api/queryKeys'
import { renderRoute } from '@/test/renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/auth', () => ({ authApi: { logout: vi.fn() } }))
vi.mock('@/api/users', () => ({
  usersApi: {
    me: vi.fn(),
    settings: vi.fn(),
    updateSettings: vi.fn(),
    quota: vi.fn(),
    changePassword: vi.fn(),
    withdraw: vi.fn(),
    verify: vi.fn(),
  },
}))

const me: Me = {
  userId: 1,
  name: '김하늘',
  email: 'haneul.kim@example.com',
  role: 'VISUALLY_IMPAIRED',
  verified: true,
  verifiedAt: '2026-10-21T15:00:00Z',
  createdAt: '2026-10-20T00:00:00Z',
}
beforeEach(() => {
  vi.resetAllMocks()
  tokenStore.set('test-session')
  vi.mocked(reissueAccessToken).mockResolvedValue('test-session')
  vi.mocked(usersApi.me).mockResolvedValue(me)
  vi.mocked(usersApi.settings).mockResolvedValue({ ...DEFAULT_SETTINGS, tutorialCompleted: true })
  vi.mocked(usersApi.quota).mockResolvedValue({
    role: 'VISUALLY_IMPAIRED',
    date: '2026-11-03',
    youtube: { limit: 5, used: 1, remaining: 4, maxDurationSec: 3600 },
    upload: { limit: 3, used: 0, remaining: 3, maxDurationSec: 3600, maxSizeBytes: 104857600 },
  })
  vi.mocked(authApi.logout).mockResolvedValue(undefined)
  vi.mocked(usersApi.changePassword).mockResolvedValue(null)
  vi.mocked(usersApi.withdraw).mockResolvedValue(null)
})

async function passwordDialog() {
  await userEvent.click(await screen.findByRole('button', { name: '비밀번호 바꾸기' }))
  return within(screen.getByRole('dialog', { name: '비밀번호 바꾸기' }))
}
async function fillPassword() {
  const dialog = await passwordDialog()
  await userEvent.type(dialog.getByLabelText(/^현재 비밀번호(?:\s*필수)?$/), 'Old-pass1!')
  await userEvent.type(dialog.getByLabelText(/^새 비밀번호(?:\s*필수)?$/), 'New-pass2!')
  await userEvent.type(dialog.getByLabelText(/^새 비밀번호 확인(?:\s*필수)?$/), 'New-pass2!')
  return dialog
}
async function withdrawDialog() {
  await userEvent.click(await screen.findByRole('button', { name: '회원 탈퇴' }))
  return within(screen.getByRole('alertdialog', { name: '정말 탈퇴할까요?' }))
}

test('계정 정보(설정 포함)·이용 횟수를 표시하고 제목에 초점을 둔다 (axe 포함)', async () => {
  const { container } = renderRoute('/me')
  expect(await screen.findByText(me.email)).toBeVisible()
  // 회원 등급에는 인증 날짜를 적지 않는다
  expect(screen.queryByText('2026년 10월 22일')).not.toBeInTheDocument()
  expect(screen.getByText('VIP')).toBeVisible()
  expect(screen.queryByRole('link', { name: '시각장애인 인증' })).not.toBeInTheDocument()
  // 인증을 마친 회원은 인증 버튼 자리에 누를 수 없는 '인증 완료'가 있다
  expect(screen.getByRole('button', { name: '인증 완료' })).toHaveAttribute('aria-disabled', 'true')
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1, name: '내 정보' })).toHaveFocus(),
  )
  expect(screen.getByText('5번 중 4번 남음')).toBeInTheDocument()
  // 설정은 계정 정보 목록 안의 '설정 바꾸기' 버튼으로 연다. 사용법 다시 듣기는 도움말에만 있다
  expect(screen.queryByRole('heading', { name: '설정' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '사용법 다시 듣기' })).not.toBeInTheDocument()
  const account = within(screen.getByRole('region', { name: '계정 정보' }))
  expect(account.getByText('설정')).toBeInTheDocument()
  expect(await account.findByRole('button', { name: '설정 바꾸기' })).not.toHaveAttribute(
    'aria-disabled',
  )
  expect(await axe(container)).toHaveNoViolations()
})

test('일반 회원에게 임의 인증 날짜를 보여 주지 않는다', async () => {
  vi.mocked(usersApi.me).mockResolvedValue({
    ...me,
    role: 'GENERAL',
    verified: false,
    verifiedAt: null,
  })
  renderRoute('/me')
  expect(await screen.findByText('일반 회원')).toBeVisible()
  expect(screen.getByRole('link', { name: '시각장애인 인증' })).toHaveAttribute('href', '/verify')
  expect(screen.queryByText('2026년 10월 22일')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '인증 완료' })).not.toBeInTheDocument()
})

test('미인증 회원은 키보드로 인증 화면에 이동하고 인증 후 돌아오면 등급·횟수가 갱신된다', async () => {
  vi.mocked(usersApi.me).mockResolvedValue({
    ...me,
    role: 'GENERAL',
    verified: false,
    verifiedAt: null,
  })
  vi.mocked(usersApi.quota).mockResolvedValue({
    role: 'GENERAL',
    date: '2026-11-03',
    youtube: { limit: 2, remaining: 2, used: 0, maxDurationSec: 600 },
    upload: { limit: 1, remaining: 1, used: 0, maxDurationSec: 600, maxSizeBytes: 104857600 },
  })
  vi.mocked(usersApi.verify).mockImplementation(async () => {
    vi.mocked(usersApi.me).mockResolvedValue(me)
    vi.mocked(usersApi.quota).mockResolvedValue({
      role: 'VISUALLY_IMPAIRED',
      date: '2026-11-03',
      youtube: { limit: 5, remaining: 5, used: 0, maxDurationSec: 3600 },
      upload: { limit: 3, remaining: 3, used: 0, maxDurationSec: 3600, maxSizeBytes: 2147483648 },
    })
    return {
      role: 'VISUALLY_IMPAIRED',
      verifiedAt: me.verifiedAt!,
      accessToken: 'verified-session',
      tokenType: 'Bearer',
      expiresIn: 3600,
    }
  })
  const { router, queryClient, container } = renderRoute('/me')
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } })
  const link = await screen.findByRole('link', { name: '시각장애인 인증' })
  expect(await screen.findByText('2번 중 2번 남음')).toBeInTheDocument()
  expect(await axe(container)).toHaveNoViolations()
  link.focus()
  await userEvent.keyboard('{Enter}')
  expect(router.state.location.pathname).toBe('/verify')
  await userEvent.upload(
    await screen.findByLabelText('인증 서류 파일 고르기'),
    new File(['test'], 'test-document.png', { type: 'image/png' }),
  )
  await userEvent.click(screen.getByRole('checkbox', { name: /민감정보/ }))
  await userEvent.click(screen.getByRole('button', { name: '인증 신청' }))
  await screen.findByRole('heading', { level: 1, name: '인증이 끝났어요' })
  await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: '내 정보' }))
  expect(await screen.findByText('VIP')).toBeVisible()
  expect(await screen.findByText('5번 중 5번 남음')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '시각장애인 인증' })).not.toBeInTheDocument()
  expect(tokenStore.get()).toBe('verified-session')
})

test('본문에서 단축키 안내를 열고 닫으면 버튼을 선택하지 않고 본문으로 초점이 돌아온다', async () => {
  renderRoute('/me')
  await screen.findByText(me.email)
  const main = screen.getByRole('main')
  main.focus()
  fireEvent.keyDown(window, { key: '/', code: 'Slash', altKey: true, shiftKey: true })
  const dialog = await screen.findByRole('dialog', { name: '단축키 안내' })
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog', { name: '단축키 안내' })).not.toBeInTheDocument()
  expect(main).toHaveFocus()
})

test('조회 실패를 표시하고 다시 불러올 수 있다', async () => {
  vi.mocked(usersApi.me).mockResolvedValueOnce(me).mockRejectedValue(new Error('offline'))
  renderRoute('/me')
  const retry = await screen.findByRole('button', { name: '다시 불러오기' })
  expect(screen.getByText('내 정보를 불러오지 못했어요.')).toBeVisible()
  vi.mocked(usersApi.me).mockResolvedValue(me)
  await userEvent.click(retry)
  expect(await screen.findByText(me.email)).toBeVisible()
})

test('비밀번호 변경은 현재 비밀번호 칸에 진입하고 빈 제출은 API를 부르지 않는다', async () => {
  renderRoute('/me')
  const dialog = await passwordDialog()
  expect(dialog.getByLabelText(/^현재 비밀번호(?:\s*필수)?$/)).toHaveFocus()
  await userEvent.click(dialog.getByRole('button', { name: '비밀번호 바꾸기' }))
  await waitFor(() =>
    expect(dialog.getByLabelText(/^현재 비밀번호(?:\s*필수)?$/)).toHaveAccessibleDescription(
      '현재 비밀번호를 입력해 주세요.',
    ),
  )
  expect(usersApi.changePassword).not.toHaveBeenCalled()
})

test('새 비밀번호의 공백·불일치를 막고 해당 칸으로 초점을 보낸다', async () => {
  renderRoute('/me')
  const dialog = await passwordDialog()
  await userEvent.type(dialog.getByLabelText(/^현재 비밀번호(?:\s*필수)?$/), 'Old-pass1!')
  await userEvent.type(dialog.getByLabelText(/^새 비밀번호(?:\s*필수)?$/), 'New pass2!')
  await userEvent.type(dialog.getByLabelText(/^새 비밀번호 확인(?:\s*필수)?$/), 'different')
  await userEvent.click(dialog.getByRole('button', { name: '비밀번호 바꾸기' }))
  await waitFor(() => expect(dialog.getByLabelText(/^새 비밀번호(?:\s*필수)?$/)).toHaveFocus())
  expect(dialog.getByLabelText(/^새 비밀번호 확인(?:\s*필수)?$/)).toHaveAccessibleDescription(
    '새 비밀번호가 서로 달라요.',
  )
  expect(usersApi.changePassword).not.toHaveBeenCalled()
})

test('현재 비밀번호 불일치는 해당 값만 비우고 오류를 연결한다', async () => {
  vi.mocked(usersApi.changePassword).mockRejectedValue(new ApiError('USER_002', 400, ''))
  renderRoute('/me')
  const dialog = await fillPassword()
  await userEvent.click(dialog.getByRole('button', { name: '비밀번호 바꾸기' }))
  await waitFor(() => expect(dialog.getByLabelText(/^현재 비밀번호(?:\s*필수)?$/)).toHaveValue(''))
  expect(dialog.getByLabelText(/^현재 비밀번호(?:\s*필수)?$/)).toHaveAccessibleDescription(
    '현재 비밀번호가 맞지 않아요. 다시 입력해 주세요.',
  )
  expect(dialog.getByLabelText(/^새 비밀번호(?:\s*필수)?$/)).toHaveValue('New-pass2!')
})

test('비밀번호 변경 성공 후 세션은 유지하고 닫기·재열기에 입력값을 남기지 않는다', async () => {
  renderRoute('/me')
  const dialog = await fillPassword()
  await userEvent.click(dialog.getByRole('button', { name: '비밀번호 바꾸기' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '비밀번호 바꾸기' })).not.toBeInTheDocument(),
  )
  expect(usersApi.changePassword).toHaveBeenCalledExactlyOnceWith('Old-pass1!', 'New-pass2!')
  expect(screen.getByRole('button', { name: '비밀번호 바꾸기' })).toHaveFocus()
  expect(tokenStore.get()).toBe('test-session')
  expect(authApi.logout).not.toHaveBeenCalled()
  const reopened = await passwordDialog()
  expect(reopened.getByLabelText(/^현재 비밀번호(?:\s*필수)?$/)).toHaveValue('')
  expect(reopened.getByLabelText(/^새 비밀번호(?:\s*필수)?$/)).toHaveValue('')
})

test('비밀번호 변경 요청 중 중복 제출·취소·Esc를 막고 실패 시 재시도할 수 있다', async () => {
  let reject!: (err: Error) => void
  vi.mocked(usersApi.changePassword).mockImplementation(
    () =>
      new Promise((_resolve, no) => {
        reject = no
      }),
  )
  renderRoute('/me')
  const dialog = await fillPassword()
  const submit = dialog.getByRole('button', { name: '비밀번호 바꾸기' })
  await userEvent.dblClick(submit)
  await userEvent.click(dialog.getByRole('button', { name: '취소' }))
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(usersApi.changePassword).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('dialog')).toBeVisible()
  reject(new Error('offline'))
  await waitFor(() =>
    expect(dialog.getByRole('button', { name: '비밀번호 바꾸기' })).not.toHaveAttribute(
      'aria-disabled',
    ),
  )
  expect(dialog.getByText('잠시 문제가 생겼어요. 조금 뒤에 다시 시도해 주세요.')).toBeVisible()
})

test('탈퇴 모달은 취소에 진입하고 취소하면 호출 버튼으로 복귀한다 (axe 포함)', async () => {
  const { container } = renderRoute('/me')
  const dialog = await withdrawDialog()
  expect(dialog.getByRole('button', { name: '취소' })).toHaveFocus()
  expect(await axe(container)).toHaveNoViolations()
  await userEvent.click(dialog.getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '회원 탈퇴' })).toHaveFocus()
  expect(usersApi.withdraw).not.toHaveBeenCalled()
})

test('탈퇴에 빈 비밀번호나 틀린 비밀번호를 입력하면 계정을 유지한다', async () => {
  vi.mocked(usersApi.withdraw).mockRejectedValue(new ApiError('USER_002', 400, ''))
  const { router } = renderRoute('/me')
  const dialog = await withdrawDialog()
  await userEvent.click(dialog.getByRole('button', { name: '탈퇴하기' }))
  expect(usersApi.withdraw).not.toHaveBeenCalled()
  await userEvent.type(dialog.getByLabelText(/^비밀번호(?:\s*필수)?$/), 'Wrong-pass1!')
  await userEvent.click(dialog.getByRole('button', { name: '탈퇴하기' }))
  await waitFor(() => expect(dialog.getByLabelText(/^비밀번호(?:\s*필수)?$/)).toHaveValue(''))
  expect(dialog.getByLabelText(/^비밀번호(?:\s*필수)?$/)).toHaveAccessibleDescription(
    '비밀번호가 맞지 않아요. 다시 입력해 주세요.',
  )
  expect(router.state.location.pathname).toBe('/me')
  expect(tokenStore.get()).toBe('test-session')
})

test('탈퇴 성공 후 재로그인 요청 없이 토큰과 개인정보 캐시를 비운다', async () => {
  const { router, queryClient } = renderRoute('/me')
  const dialog = await withdrawDialog()
  queryClient.setQueryData(['private-test'], { secret: 'private' })
  await userEvent.type(dialog.getByLabelText(/^비밀번호(?:\s*필수)?$/), 'Old-pass1!')
  await userEvent.click(dialog.getByRole('button', { name: '탈퇴하기' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/landing'))
  expect(usersApi.withdraw).toHaveBeenCalledExactlyOnceWith('Old-pass1!')
  expect(tokenStore.get()).toBeNull()
  expect(queryClient.getQueryData(['private-test'])).toBeUndefined()
  expect(authApi.logout).not.toHaveBeenCalled()
})

test('탈퇴 통신 실패는 모달과 로그인을 유지하고 오류를 알린다', async () => {
  vi.mocked(usersApi.withdraw).mockRejectedValue(new Error('offline'))
  const { router } = renderRoute('/me')
  const dialog = await withdrawDialog()
  await userEvent.type(dialog.getByLabelText(/^비밀번호(?:\s*필수)?$/), 'Old-pass1!')
  await userEvent.click(dialog.getByRole('button', { name: '탈퇴하기' }))
  expect(
    await dialog.findByText('잠시 문제가 생겼어요. 조금 뒤에 다시 시도해 주세요.'),
  ).toBeVisible()
  expect(router.state.location.pathname).toBe('/me')
  expect(tokenStore.get()).toBe('test-session')
})

test.each([false, true])(
  '헤더의 로그아웃은 서버 실패 여부(%s)와 관계없이 이 기기 상태를 비운다',
  async (fails) => {
    if (fails) vi.mocked(authApi.logout).mockRejectedValue(new Error('offline'))
    const { router, queryClient } = renderRoute('/me')
    await screen.findByText(me.email)
    queryClient.setQueryData(['private-test'], 'private')
    // 로그아웃은 내 정보 본문이 아니라 헤더(이름 오른쪽)에 있다
    expect(
      within(screen.getByRole('main')).queryByRole('button', { name: '로그아웃' }),
    ).not.toBeInTheDocument()
    const header = within(screen.getByRole('banner'))
    expect(header.getByText(`${me.name} 님`)).toBeInTheDocument()
    await userEvent.click(header.getByRole('button', { name: '로그아웃' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/landing'))
    // 랜딩의 입장 안내 앞에 붙여 한 번에 읽는다 (따로 보내면 입장 안내에 덮인다)
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: /영상 화면해설/ })).toHaveFocus(),
    )
    expect(tokenStore.get()).toBeNull()
    expect(queryClient.getQueryData(['private-test'])).toBeUndefined()
  },
)

test('설정 창을 열어 고대비 변경을 저장하고 닫으면 버튼으로 돌아온다', async () => {
  vi.mocked(usersApi.updateSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, highContrast: true })
  renderRoute('/me')
  const open = await screen.findByRole('button', { name: '설정 바꾸기' })
  await waitFor(() => expect(open).not.toHaveAttribute('aria-disabled'))
  await userEvent.click(open)
  const dialog = within(screen.getByRole('dialog', { name: '설정' }))
  await userEvent.click(dialog.getByRole('checkbox', { name: '켜기' }))
  expect(usersApi.updateSettings).toHaveBeenCalledWith({ highContrast: true })
  await waitFor(() => expect(document.documentElement.dataset.contrast).toBe('high'))
  await userEvent.click(dialog.getByRole('button', { name: '닫기' }))
  expect(open).toHaveFocus()
})

test('설정 저장 실패 시 이전 값으로 원복하고 성공 안내를 하지 않는다', async () => {
  vi.mocked(usersApi.updateSettings).mockRejectedValue(new Error('offline'))
  const { queryClient } = renderRoute('/me')
  const open = await screen.findByRole('button', { name: '설정 바꾸기' })
  await waitFor(() => expect(open).not.toHaveAttribute('aria-disabled'))
  await userEvent.click(open)
  const dialog = within(screen.getByRole('dialog', { name: '설정' }))
  await userEvent.click(dialog.getByRole('radio', { name: '3 자세한 해설' }))
  await waitFor(() => expect(dialog.getByRole('radio', { name: '2 기본 해설' })).toBeChecked())
  expect(queryClient.getQueryData(queryKeys.settings)).toMatchObject({ detailLevel: 2 })
  expect(document.querySelector('[aria-live="polite"]')).not.toHaveTextContent(
    '해설 상세도 3 자세한 해설.',
  )
})

test('설정·횟수 조회 실패를 표시하고 각각 다시 불러올 수 있다', async () => {
  vi.mocked(usersApi.settings).mockRejectedValue(new Error('offline'))
  vi.mocked(usersApi.quota).mockRejectedValue(new Error('offline'))
  renderRoute('/me')
  const settingsRetry = await screen.findByRole('button', { name: '설정 다시 불러오기' })
  const quotaRetry = await screen.findByRole('button', { name: '횟수 다시 불러오기' })
  expect(screen.getByRole('button', { name: '설정 바꾸기' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  vi.mocked(usersApi.settings).mockResolvedValue(DEFAULT_SETTINGS)
  vi.mocked(usersApi.quota).mockResolvedValue({
    role: 'GENERAL',
    date: '2026-11-03',
    youtube: { limit: 2, remaining: 2, used: 0, maxDurationSec: 600 },
    upload: { limit: 1, remaining: 1, used: 0, maxDurationSec: 600, maxSizeBytes: 104857600 },
  })
  await userEvent.click(settingsRetry)
  await userEvent.click(quotaRetry)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '설정 바꾸기' })).not.toHaveAttribute(
      'aria-disabled',
    ),
  )
  expect(await screen.findByText('2번 중 2번 남음')).toBeInTheDocument()
})

test('비밀번호 보기 상태와 입력값을 닫은 뒤 다음 열기에 남기지 않는다', async () => {
  renderRoute('/me')
  const dialog = await fillPassword()
  await userEvent.click(dialog.getByRole('button', { name: '새 비밀번호 보기' }))
  expect(dialog.getByLabelText(/^새 비밀번호(?:\s*필수)?$/)).toHaveAttribute('type', 'text')
  await userEvent.click(dialog.getByRole('button', { name: '취소' }))
  const reopened = await passwordDialog()
  const input = reopened.getByLabelText(/^새 비밀번호(?:\s*필수)?$/)
  expect(input).toHaveValue('')
  expect(input).toHaveAttribute('type', 'password')
})
