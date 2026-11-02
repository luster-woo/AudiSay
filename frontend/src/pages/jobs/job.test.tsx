import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { jobsApi } from '@/api/jobs'
import { videosApi } from '@/api/videos'
import { subscribeSse, type SseOptions } from '@/api/sse'
import { DEFAULT_SETTINGS, type Job, type VideoDetail } from '@/api/types'
import { renderRoute } from '@/test/renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/users', () => ({
  usersApi: {
    me: vi.fn(),
    settings: vi.fn(),
    updateSettings: vi.fn(),
    quota: vi.fn(),
    myVideos: vi.fn(),
  },
}))
vi.mock('@/api/jobs', () => ({
  jobsApi: { get: vi.fn(), streamPath: (id: number) => `/jobs/${id}/stream` },
}))
vi.mock('@/api/videos', () => ({ videosApi: { get: vi.fn(), retry: vi.fn() } }))
vi.mock('@/api/sse', () => ({ subscribeSse: vi.fn() }))

const job = (over: Partial<Job> = {}): Job => ({
  jobId: 51,
  videoId: 15,
  jobType: 'GENERATE',
  status: 'RUNNING',
  currentStage: 'DESCRIBE',
  progress: 50,
  estimatedRemainingSec: 80,
  descriptionId: null,
  coveredUntilMs: null,
  errorCode: null,
  retryable: null,
  queuedAt: '2026-11-02T01:00:00Z',
  startedAt: '2026-11-02T01:00:00Z',
  finishedAt: null,
  ...over,
})
const video: VideoDetail = {
  videoId: 15,
  sourceType: 'UPLOAD',
  youtubeVideoId: null,
  title: '그래프를 읽는 방법',
  channelTitle: '김하늘',
  thumbnailUrl: null,
  durationSec: 282,
  category: 'EDUCATION',
  isFavorite: false,
  visibility: 'PRIVATE',
  status: 'REGISTERED',
  isOwner: true,
  descriptionId: null,
  activeJobId: 51,
}

/** 가장 최근 SSE 구독의 콜백 */
const sse = () => vi.mocked(subscribeSse).mock.lastCall![1] as SseOptions
const band = () => screen.getByRole('region', { name: '방금 안내', hidden: true })

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
  vi.mocked(usersApi.settings).mockResolvedValue({ ...DEFAULT_SETTINGS, tutorialCompleted: true })
  vi.mocked(videosApi.get).mockResolvedValue(video)
  vi.mocked(subscribeSse).mockResolvedValue(undefined)
})

test('진행 중: 제목에 포커스, 영상 정보·진행률·남은 시간, 단계와 퍼센트를 읽어 준다', async () => {
  vi.mocked(jobsApi.get).mockResolvedValue(job())
  const { container } = renderRoute('/jobs/51')
  const h1 = await screen.findByRole('heading', { level: 1, name: '해설을 만들고 있어요' })
  await waitFor(() => expect(h1).toHaveFocus())
  expect(await screen.findByText('그래프를 읽는 방법 · 4분 42초')).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: '해설 만들기 진행률' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  )
  expect(screen.getByText('약 1분 20초 남았어요')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '홈으로 가기' })).toHaveAttribute('href', '/')
  expect(screen.getByRole('link', { name: '영상 등록' })).toHaveAttribute('aria-current', 'page')
  await waitFor(() => expect(band()).toHaveTextContent('장면 해설을 만드는 중이에요, 50퍼센트.'))
  expect(subscribeSse).toHaveBeenCalledWith('/jobs/51/stream', expect.anything())
  expect(await axe(container)).toHaveNoViolations()
})

test('SSE 진행률은 10% 단위로만 읽고, 완료되면 준비 창의 지금 보기에 포커스', async () => {
  const user = userEvent.setup()
  vi.mocked(jobsApi.get).mockResolvedValue(job())
  const { router } = renderRoute('/jobs/51')
  await screen.findByRole('heading', { name: '해설을 만들고 있어요' })
  await waitFor(() => expect(subscribeSse).toHaveBeenCalled())

  act(() =>
    sse().onMessage({
      event: 'progress',
      data: JSON.stringify({
        status: 'RUNNING',
        currentStage: 'DESCRIBE',
        progress: 54,
        estimatedRemainingSec: 60,
      }),
    }),
  )
  expect(await screen.findByText('약 1분 남았어요')).toBeInTheDocument()
  expect(band()).toHaveTextContent('50퍼센트')

  act(() =>
    sse().onMessage({
      event: 'progress',
      data: JSON.stringify({
        status: 'RUNNING',
        currentStage: 'TTS',
        progress: 90,
        estimatedRemainingSec: 20,
      }),
    }),
  )
  await waitFor(() => expect(band()).toHaveTextContent('해설 음성을 만드는 중이에요, 90퍼센트.'))

  vi.mocked(jobsApi.get).mockResolvedValue(
    job({
      status: 'SUCCEEDED',
      progress: 100,
      descriptionId: 20,
      finishedAt: '2026-11-02T01:02:12Z',
    }),
  )
  act(() =>
    sse().onMessage({
      event: 'completed',
      data: JSON.stringify({ status: 'SUCCEEDED', descriptionId: 20, coveredUntilMs: null }),
    }),
  )

  const dialog = await screen.findByRole('dialog', { name: '해설이 준비됐어요.' })
  expect(within(dialog).getByText('지금 볼까요?')).toBeInTheDocument()
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: '지금 보기' })).toHaveFocus(),
  )
  await waitFor(() =>
    expect(band()).toHaveTextContent('해설이 준비됐어요. 지금 보기 버튼에 있어요.'),
  )
  expect(await screen.findByText('다 만들었어요 · 2분 12초 걸렸어요')).toBeInTheDocument()

  await user.click(within(dialog).getByRole('button', { name: '지금 보기' }))
  expect(router.state.location.pathname).toBe('/watch/15')
})

test('나중에 보기를 고르면 창이 닫히고 화면에 지금 보기 링크가 남는다', async () => {
  const user = userEvent.setup()
  vi.mocked(jobsApi.get).mockResolvedValue(
    job({ status: 'SUCCEEDED', progress: 100, finishedAt: '2026-11-02T01:02:12Z' }),
  )
  renderRoute('/jobs/51')
  const dialog = await screen.findByRole('dialog', { name: '해설이 준비됐어요.' })
  expect(
    screen.getByRole('heading', { level: 1, name: '해설을 다 만들었어요' }),
  ).toBeInTheDocument()
  expect(subscribeSse).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: '나중에 보기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('link', { name: '지금 보기' })).toHaveAttribute('href', '/watch/15')
})

test('실패(다시 요청 가능): 다시 요청하면 새 작업 화면으로 옮긴다', async () => {
  const user = userEvent.setup()
  vi.mocked(jobsApi.get).mockResolvedValueOnce(
    job({ status: 'FAILED', errorCode: 'AI_TIMEOUT', retryable: true }),
  )
  vi.mocked(videosApi.retry).mockResolvedValue({
    videoId: 15,
    jobId: 52,
    result: 'NEW_JOB',
    counted: false,
    retryRemainingToday: 2,
  })
  const { router } = renderRoute('/jobs/51')
  const dialog = await screen.findByRole('alertdialog', { name: '해설을 만들지 못했어요.' })
  expect(within(dialog).getByText('다시 요청해도 오늘 횟수는 줄지 않아요.')).toBeInTheDocument()
  expect(screen.getByText('장면 해설을 만드는 중에 멈췄어요')).toBeInTheDocument()
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: '다시 요청' })).toHaveFocus(),
  )
  await waitFor(() =>
    expect(band()).toHaveTextContent('해설을 만들지 못했어요. 다시 요청 버튼에 있어요.'),
  )

  // Esc 로는 닫히지 않는다
  await user.keyboard('{Escape}')
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()

  vi.mocked(jobsApi.get).mockResolvedValue(job({ jobId: 52, progress: 0, currentStage: 'PREPARE' }))
  await user.click(within(dialog).getByRole('button', { name: '다시 요청' }))
  expect(videosApi.retry).toHaveBeenCalledWith(15)
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/52'))
  expect(await screen.findByRole('heading', { name: '해설을 만들고 있어요' })).toBeInTheDocument()
})

test('실패(다시 요청 불가): 이유를 보여 주고 홈으로 가기가 먼저', async () => {
  vi.mocked(jobsApi.get).mockResolvedValue(
    job({ status: 'FAILED', errorCode: 'TRANSCODE_FAILED', retryable: false }),
  )
  renderRoute('/jobs/51')
  const dialog = await screen.findByRole('alertdialog', { name: '해설을 만들지 못했어요.' })
  expect(within(dialog).getByText('영상 파일을 읽을 수 없어요.')).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: '홈으로 가기' })).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: '내 영상 보기' })).toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: '다시 요청' })).not.toBeInTheDocument()
})

test('SSE 가 끊기면 5초마다 작업 상태를 다시 받는다', async () => {
  vi.mocked(jobsApi.get).mockResolvedValue(job())
  renderRoute('/jobs/51')
  await screen.findByRole('heading', { name: '해설을 만들고 있어요' })
  await waitFor(() => expect(subscribeSse).toHaveBeenCalled())
  const before = vi.mocked(jobsApi.get).mock.calls.length

  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    vi.mocked(jobsApi.get).mockResolvedValue(job({ progress: 70, estimatedRemainingSec: 30 }))
    act(() => sse().onClose('timeout'))
    await act(() => vi.advanceTimersByTimeAsync(5_100))
    expect(vi.mocked(jobsApi.get).mock.calls.length).toBeGreaterThanOrEqual(before + 2)
    expect(await screen.findByText('약 30초 남았어요')).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

test('없는 작업이면 안내와 홈 링크', async () => {
  const { ApiError } = await import('@/api/errors')
  vi.mocked(jobsApi.get).mockRejectedValue(new ApiError('JOB_001', 404, '없는 작업'))
  renderRoute('/jobs/999')
  expect(await screen.findByRole('heading', { name: '작업을 찾을 수 없어요' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '홈으로 가기' })).toBeInTheDocument()
})
