import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { ApiError } from '@/api/errors'
import { usersApi } from '@/api/users'
import { adminApi } from '@/api/admin'
import type { ChatStats } from '@/api/types'
import { formatMs, formatVideoTime } from '@/features/admin/chatStats'
import { presetRange } from '@/features/admin/stats'
import { renderRoute } from '@/test/renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/users', () => ({
  usersApi: { me: vi.fn(), settings: vi.fn(), updateSettings: vi.fn() },
}))
vi.mock('@/api/admin', () => ({
  adminApi: { reports: vi.fn(), users: vi.fn(), aiUsage: vi.fn(), chatStats: vi.fn() },
}))

const stats = (from: string, to: string): ChatStats => ({
  from,
  to,
  inputs: 354,
  byIntent: [
    { intent: 'QUESTION', count: 124, intentP50Ms: 820, intentP95Ms: 1480 },
    { intent: 'ACTION', count: 96, intentP50Ms: 1, intentP95Ms: 3 },
    { intent: 'SEEK_SCENE', count: 41, intentP50Ms: 35, intentP95Ms: 1120 },
    { intent: 'SCENE_NOW', count: 28, intentP50Ms: 2, intentP95Ms: 4 },
    { intent: 'SEEK_TIME', count: 22, intentP50Ms: 1, intentP95Ms: 2 },
    { intent: 'SETTING', count: 15, intentP50Ms: 1, intentP95Ms: 3 },
    { intent: 'UNKNOWN', count: 12, intentP50Ms: 910, intentP95Ms: 1750 },
    { intent: 'RECAP', count: 9, intentP50Ms: 760, intentP95Ms: 1390 },
    { intent: 'SEARCH_VIDEO', count: 7, intentP50Ms: 640, intentP95Ms: 1610 },
  ],
  answer: {
    byIntent: [
      {
        intent: 'QUESTION',
        answered: 118,
        stored: 82,
        unanswerable: 30,
        future: 6,
        firstAudioP50Ms: 1240,
        firstAudioP95Ms: 2870,
      },
      {
        intent: 'SCENE_NOW',
        answered: 27,
        stored: 27,
        unanswerable: 0,
        future: 0,
        firstAudioP50Ms: 980,
        firstAudioP95Ms: 1520,
      },
    ],
    questions: 118,
    notAnsweredDirectly: 36,
    futureOffered: 14,
    futureChosen: 6,
    unanswerableRate: 36 / 118,
    futureOfferedRate: 14 / 36,
    futureChosenRate: 6 / 14,
  },
  seek: { total: 41, keyword: 29, llm: 9, notFound: 3, keywordRate: 29 / 41 },
  recentUnanswered: [
    {
      chatLogId: 41,
      videoId: 2,
      videoTitle: '하늘 나는 테슬라 로드스터',
      videoTimeMs: 250_000,
      utterance: '이 차 가격이 얼마야?',
      createdAt: '2026-11-04 14:00',
    },
    {
      chatLogId: 40,
      videoId: null,
      videoTitle: null,
      videoTimeMs: null,
      utterance: '요즘 인기 영상 뭐 있어?',
      createdAt: '2026-11-03 09:12',
    },
  ],
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
  vi.mocked(adminApi.chatStats).mockImplementation(async (from, to) => stats(from, to))
})

test('시간 표기', () => {
  expect(formatMs(3)).toBe('3ms')
  expect(formatMs(1480)).toBe('1.48초')
  expect(formatMs(null)).toBe('–')
  expect(formatVideoTime(250_000)).toBe('4:10')
  expect(formatVideoTime(3_723_000)).toBe('1:02:03')
})

describe('챗봇 품질 통계', () => {
  test('최근 30일로 불러와 요약·답변 결과·장면 찾기·표·답 없던 질문을 보여 준다', async () => {
    const { container } = renderRoute('/admin/chat-stats')

    const heading = await screen.findByRole('heading', { level: 1, name: '챗봇 품질 통계' })
    await waitFor(() => expect(heading).toHaveFocus())
    const { from, to } = presetRange('30d')
    expect(adminApi.chatStats).toHaveBeenCalledWith(from, to)

    // 사이드바: 통계 바로 아래, 지금 화면만 선택됨
    const menu = screen.getByRole('navigation', { name: '운영 관리 메뉴' })
    const links = within(menu)
      .getAllByRole('link')
      .map((l) => l.textContent)
    expect(links.indexOf('챗봇 품질 통계')).toBe(links.indexOf('통계') + 1)
    expect(within(menu).getByRole('link', { name: '챗봇 품질 통계' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(menu).getByRole('link', { name: '통계' })).not.toHaveAttribute('aria-current')

    const summary = screen.getByRole('region', { name: '기간 요약' })
    expect(summary).toHaveTextContent('챗봇 입력354건')
    expect(summary).toHaveTextContent('바로 답한 질문69.5%82 / 118건')
    expect(summary).toHaveTextContent('첫 응답 음성 p952.87초p50 1.24초')
    expect(summary).toHaveTextContent('분류 시간 p95 (최대)1.75초목표 1.5초 초과 · 못 알아들음')
    expect(summary).toHaveTextContent('못 알아들은 입력3.4%12건')
    expect(summary).toHaveTextContent('장면 찾기 성공92.7%38 / 41건')

    const items = (name: string) =>
      within(screen.getByRole('region', { name }))
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    const answer = screen.getByRole('region', { name: '질문 답변 결과' })
    expect(answer).toHaveTextContent('질문 118건')
    expect(items('질문 답변 결과')).toEqual([
      '바로 답함82건69.5%',
      '뒤에 답 있음 · 들음6건5.1%',
      '뒤에 답 있음 · 안 들음8건6.8%',
      '답 없음22건18.6%',
    ])
    // BE가 rag 를 주지 않아도 RAG 칸은 '준비 중'으로 보인다
    expect(items('장면 찾기')).toEqual([
      '키워드29건70.7%',
      'RAG준비 중',
      'AI 선택9건22.0%',
      '못 찾음3건7.3%',
    ])

    const intent = within(screen.getByRole('region', { name: '입력 종류별' }))
    const unknown = intent.getByRole('row', { name: /못 알아들음/ })
    expect(within(unknown).getByRole('cell', { name: '1.75초' })).toHaveClass('text-danger')
    expect(intent.getByRole('row', { name: /영상 조작/ })).toHaveTextContent('1ms3ms')
    expect(intent.queryByText('QUESTION')).not.toBeInTheDocument()

    const byAnswer = within(screen.getByRole('region', { name: '답변 종류별' }))
    expect(byAnswer.getByRole('row', { name: /지금 장면 설명/ })).toHaveTextContent('980ms1.52초')

    const unanswered = screen.getByRole('region', { name: '답이 없던 질문' })
    expect(unanswered).toHaveTextContent('최근 2건 / 전체 22건')
    expect(unanswered).toHaveTextContent(
      '11-04 14:00이 차 가격이 얼마야?하늘 나는 테슬라 로드스터4:10',
    )
    expect(unanswered).toHaveTextContent('09:12요즘 인기 영상 뭐 있어?––')

    expect(await axe(container)).toHaveNoViolations()
  })

  test('BE가 rag 를 주면 장면 찾기에 RAG 칸을 보여 주고 성공에 더한다', async () => {
    vi.mocked(adminApi.chatStats).mockImplementation(async (from, to) => ({
      ...stats(from, to),
      seek: { total: 41, keyword: 25, rag: 6, llm: 7, notFound: 3, keywordRate: 25 / 41 },
    }))
    renderRoute('/admin/chat-stats')
    const seek = await screen.findByRole('region', { name: '장면 찾기' })
    const items = within(seek)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(items).toEqual(['키워드25건61.0%', 'RAG6건14.6%', 'AI 선택7건17.1%', '못 찾음3건7.3%'])
    expect(screen.getByRole('region', { name: '기간 요약' })).toHaveTextContent(
      '장면 찾기 성공92.7%38 / 41건',
    )
  })

  test('기간을 고르면 다시 불러오고 요약을 읽어 준다', async () => {
    renderRoute('/admin/chat-stats')
    await screen.findByRole('heading', { level: 1, name: '챗봇 품질 통계' })
    await userEvent.click(screen.getByRole('radio', { name: '최근 7일' }))
    const { from, to } = presetRange('7d')
    expect(adminApi.chatStats).toHaveBeenLastCalledWith(from, to)
    await waitFor(() =>
      expect(screen.getByText(/입력 354건, 바로 답한 질문 69.5%/)).toBeInTheDocument(),
    )
  })

  test('기록이 없으면 빈 안내를 보여 준다', async () => {
    vi.mocked(adminApi.chatStats).mockResolvedValue({
      from: '2026-11-01',
      to: '2026-11-01',
      inputs: 0,
      byIntent: [],
      answer: {
        byIntent: [],
        questions: 0,
        notAnsweredDirectly: 0,
        futureOffered: 0,
        futureChosen: 0,
        unanswerableRate: 0,
        futureOfferedRate: 0,
        futureChosenRate: 0,
      },
      seek: { total: 0, keyword: 0, llm: 0, notFound: 0, keywordRate: 0 },
      recentUnanswered: [],
    })
    renderRoute('/admin/chat-stats')
    const summary = await screen.findByRole('region', { name: '기간 요약' })
    expect(summary).toHaveTextContent('바로 답한 질문–0 / 0건')
    expect(summary).toHaveTextContent('분류 시간 p95 (최대)–못 알아들은')
    expect(summary).toHaveTextContent('장면 찾기 성공–')
    // 표·목록은 '기록 없음', 막대 카드는 0건과 '–'
    expect(screen.getAllByText('기록 없음')).toHaveLength(3)
    const seek = screen.getByRole('region', { name: '장면 찾기' })
    expect(within(seek).getByText('키워드').closest('li')).toHaveTextContent('0건–')
    expect(within(seek).getByText('RAG').closest('li')).toHaveTextContent('준비 중')
  })

  test('서버가 거부하면 그 말을 보여 준다', async () => {
    vi.mocked(adminApi.chatStats).mockRejectedValue(
      new ApiError('COMMON_001', 400, '기간은 92일까지 조회할 수 있어요.'),
    )
    renderRoute('/admin/chat-stats')
    expect(
      await screen.findByText(/통계를 불러오지 못했어요/, { selector: 'p' }),
    ).toBeInTheDocument()
  })
})
