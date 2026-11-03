import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { ApiError } from '@/api/errors'
import { usersApi } from '@/api/users'
import { adminApi } from '@/api/admin'
import type { AiUsageDaily, AiUsageStats } from '@/api/types'
import { addDays, presetRange, rangeDays, validateRange } from '@/features/admin/stats'
import { renderRoute } from '@/test/renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/users', () => ({
  usersApi: { me: vi.fn(), settings: vi.fn(), updateSettings: vi.fn() },
}))
vi.mock('@/api/admin', () => ({
  adminApi: { reports: vi.fn(), users: vi.fn(), aiUsage: vi.fn() },
}))

const day = (date: string, calls: number): AiUsageDaily => ({
  date,
  calls,
  inputTokens: calls * 1000,
  outputTokens: calls * 200,
  estimatedCredits: calls * 1.5,
})

const stats = (from: string, to: string): AiUsageStats => {
  const daily: AiUsageDaily[] = []
  for (let i = 0; i < rangeDays(from, to); i++) daily.push(day(addDays(from, i), i === 0 ? 0 : 10))
  return {
    from,
    to,
    summary: {
      calls: 1234,
      inputTokens: 3_820_000,
      outputTokens: 410_000,
      estimatedCredits: 812.4,
      errorRate: 0.021,
      fallbackRate: 0.004,
    },
    byPurpose: [
      {
        purpose: 'DESCRIBE',
        calls: 210,
        inputTokens: 3_100_000,
        outputTokens: 300_000,
        estimatedCredits: 640.2,
        errorRate: 0.01,
        p50LatencyMs: 21_000,
        p95LatencyMs: 80_500,
      },
      {
        purpose: 'QUESTION',
        calls: 900,
        inputTokens: 700_000,
        outputTokens: 100_000,
        estimatedCredits: 172.2,
        errorRate: 0.08,
        p50LatencyMs: 900,
        p95LatencyMs: null,
      },
    ],
    byModel: [
      {
        model: 'gemini-2.5-flash',
        calls: 1110,
        inputTokens: 3_800_000,
        outputTokens: 400_000,
        estimatedCredits: 812.4,
      },
      {
        model: 'h200:qwen3-omni',
        calls: 124,
        inputTokens: 20_000,
        outputTokens: 10_000,
        estimatedCredits: 0,
      },
    ],
    daily,
    reuse: {
      newJob: 150,
      reused: 60,
      joinedJob: 5,
      avgCreditsPerVideo: 4.3,
      savedCredits: 279.5,
      savedRate: 0.3,
    },
  }
}

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
  vi.mocked(adminApi.aiUsage).mockImplementation(async (from, to) => stats(from, to))
})

describe('기간 계산', () => {
  test('프리셋은 오늘을 끝으로 하고, 최대 92일을 넘으면 거른다', () => {
    expect(presetRange('today', '2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-02' })
    expect(presetRange('7d', '2026-11-02')).toEqual({ from: '2026-10-27', to: '2026-11-02' })
    expect(presetRange('30d', '2026-11-02')).toEqual({ from: '2026-10-04', to: '2026-11-02' })
    expect(presetRange('month', '2026-11-02')).toEqual({ from: '2026-11-01', to: '2026-11-02' })
    expect(validateRange('2026-08-02', '2026-11-01')).toBeNull() // 92일
    expect(validateRange('2026-08-01', '2026-11-01')).toMatch('최대 92일')
    expect(validateRange('2026-11-02', '2026-11-01')).toMatch('늦어요')
    expect(validateRange('', '2026-11-01')).toMatch('YYYY-MM-DD')
  })
})

describe('통계', () => {
  test('최근 30일로 불러와 요약·용도별·모델별·재사용을 보여 주고, 제목에 포커스를 둔다', async () => {
    const { container } = renderRoute('/admin/stats')

    const heading = await screen.findByRole('heading', { level: 1, name: '통계' })
    await waitFor(() => expect(heading).toHaveFocus())
    const { from, to } = presetRange('30d')
    expect(adminApi.aiUsage).toHaveBeenCalledWith(from, to)
    expect(screen.getByRole('radio', { name: '최근 30일' })).toBeChecked()
    // 사이드바는 '해설 검수' 대신 '통계'
    const menu = screen.getByRole('navigation', { name: '운영 관리 메뉴' })
    expect(within(menu).getByRole('link', { name: '통계' })).toHaveAttribute('aria-current', 'page')
    expect(within(menu).queryByRole('link', { name: '해설 검수' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '현재 위치' })).not.toBeInTheDocument()

    // 요약 여섯 칸
    const summary = screen.getByRole('region', { name: '기간 요약' })
    expect(summary).toHaveTextContent('호출 수1,234건')
    expect(summary).toHaveTextContent('추정 크레딧812.4')
    expect(summary).toHaveTextContent('입력 토큰3,820,000')
    expect(summary).toHaveTextContent('오류율2.1%')
    expect(summary).toHaveTextContent('대체 응답 비율0.4%')

    // 용도별: 이름 바꿔 보여 주고 지연은 초로
    const purpose = within(screen.getByRole('region', { name: '용도별' }))
    const describe = purpose.getByRole('row', { name: /해설 생성/ })
    expect(describe).toHaveTextContent('640.2')
    expect(describe).toHaveTextContent('78.8%')
    expect(describe).toHaveTextContent('21초')
    expect(describe).toHaveTextContent('1분 21초')
    expect(purpose.getByRole('row', { name: /질문 답변/ })).toHaveTextContent('0.9초–')

    // 모델별: 자체 서버는 크레딧 0
    const model = within(screen.getByRole('region', { name: '모델별' }))
    expect(model.getByRole('row', { name: /h200:qwen3-omni/ })).toHaveTextContent('자체 서버')

    // 재사용
    const reuse = screen.getByRole('region', { name: '해설 재사용 효과' })
    expect(reuse).toHaveTextContent('유튜브 영상 215건 중 65건은 새로 만들지 않았어요.')
    expect(reuse).toHaveTextContent('절감률30.0%')

    expect(await axe(container)).toHaveNoViolations()
  })

  test('기간을 고르면 다시 불러오고 요약을 읽어 준다. 날짜별은 표로도 볼 수 있다', async () => {
    renderRoute('/admin/stats')
    await screen.findByRole('heading', { level: 1, name: '통계' })

    await userEvent.click(screen.getByRole('radio', { name: '최근 7일' }))
    const { from, to } = presetRange('7d')
    expect(adminApi.aiUsage).toHaveBeenLastCalledWith(from, to)
    await waitFor(() => expect(screen.getByText(/호출 1,234건, 크레딧 812.4/)).toBeInTheDocument())

    // 날짜별 표: 7줄, 고른 값(크레딧) 칸은 굵게
    await userEvent.click(screen.getByRole('button', { name: '표로 보기' }))
    const table = screen.getByRole('table', { name: '날짜별 AI 사용량' })
    expect(within(table).getAllByRole('row')).toHaveLength(8)
    const last = within(table).getByRole('row', { name: new RegExp(to) })
    expect(within(last).getByRole('cell', { name: '15' })).toHaveClass('font-bold')
    expect(within(last).getByRole('cell', { name: '10' })).not.toHaveClass('font-bold')

    await userEvent.click(screen.getByRole('radio', { name: '호출 수' }))
    expect(within(last).getByRole('cell', { name: '10' })).toHaveClass('font-bold')
    expect(screen.getByRole('button', { name: '표로 보기' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('직접 고른 기간이 잘못되면 보내지 않고 이유를 보여 준다', async () => {
    renderRoute('/admin/stats')
    await screen.findByRole('heading', { level: 1, name: '통계' })
    expect(adminApi.aiUsage).toHaveBeenCalledTimes(1)

    const fromBox = screen.getByLabelText('시작')
    const toBox = screen.getByLabelText('끝')
    await userEvent.clear(fromBox)
    await userEvent.type(fromBox, '2026-07-01')
    await userEvent.clear(toBox)
    await userEvent.type(toBox, '2026-11-01')
    await userEvent.click(screen.getByRole('button', { name: '조회' }))

    expect(adminApi.aiUsage).toHaveBeenCalledTimes(1)
    expect(fromBox).toHaveAccessibleDescription(/최대 92일/)
    expect(fromBox).toHaveAttribute('aria-invalid', 'true')

    await userEvent.clear(fromBox)
    await userEvent.type(fromBox, '2026-10-01')
    await userEvent.click(screen.getByRole('button', { name: '조회' }))
    expect(adminApi.aiUsage).toHaveBeenLastCalledWith('2026-10-01', '2026-11-01')
    expect(fromBox).not.toHaveAttribute('aria-invalid')
    // 프리셋은 풀린다
    expect(screen.getByRole('radio', { name: '최근 30일' })).not.toBeChecked()
  })

  test('서버가 거부하면 그 말을 보여 준다', async () => {
    vi.mocked(adminApi.aiUsage).mockRejectedValue(
      new ApiError('COMMON_001', 400, '조회 기간은 최대 92일입니다.'),
    )
    renderRoute('/admin/stats')
    expect(
      await screen.findByText(/통계를 불러오지 못했어요/, { selector: 'p' }),
    ).toBeInTheDocument()
  })
})
