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
vi.mock('@/api/videos', () => ({
  videosApi: {
    get: vi.fn(),
    retry: vi.fn(),
    // 지금 보기 → /watch 로 넘어간 뒤 시청 화면이 부르는 것들 (여기서는 내용을 확인하지 않는다)
    playback: vi.fn(() => new Promise(() => undefined)),
    description: vi.fn(() => new Promise(() => undefined)),
    chapters: vi.fn(() => new Promise(() => undefined)),
    summary: vi.fn(() => new Promise(() => undefined)),
    chatHistory: vi.fn(() => new Promise(() => undefined)),
  },
}))
vi.mock('@/api/sse', () => ({ subscribeSse: vi.fn() }))

const job = (over: Partial<Job> = {}): Job => ({
  jobId: 51,
  videoId: 15,
  jobType: 'GENERATE',
  status: 'RUNNING',
  currentStage: 'DESCRIBE',
  progress: 50,
  estimatedRemainingSec: 80,
  estimatedTotalSec: null,
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

/** 단계 목록의 항목 글 ("영상 분석, 완료") */
const steps = () =>
  within(screen.getByRole('list', { name: '진행 단계' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)

test('진행 중: 제목에 포커스, 영상 정보·진행률·남은 시간, 단계와 퍼센트를 읽어 준다', async () => {
  vi.mocked(jobsApi.get).mockResolvedValue(job())
  const { container } = renderRoute('/jobs/51')
  const h1 = await screen.findByRole('heading', { level: 1, name: '해설을 만들고 있어요' })
  await waitFor(() => expect(h1).toHaveFocus())
  expect(await screen.findByText('그래프를 읽는 방법 · 4분 42초')).toBeInTheDocument()
  // 업로드 영상: 서버 50(DESCRIBE 20~70의 60%) → 화면 78(75~80의 60%) → 업로드 몫 15 + 78 × 0.85 = 81
  expect(screen.getByRole('progressbar', { name: '해설 만들기 진행률' })).toHaveAttribute(
    'aria-valuenow',
    '81',
  )
  expect(screen.getByText('약 1분 20초 남았어요')).toBeInTheDocument()
  expect(steps()).toEqual([
    '영상 업로드, 완료',
    '영상 분석, 완료',
    '장면 해설 만들기, 진행 중',
    '해설 합치고 다듬기, 대기',
    '해설 음성 만들기, 대기',
  ])
  expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('장면 해설 만들기')
  expect(screen.getByRole('link', { name: '홈으로 가기' })).toHaveAttribute('href', '/')
  expect(screen.getByRole('link', { name: '영상 등록' })).toHaveAttribute('aria-current', 'page')
  await waitFor(() => expect(band()).toHaveTextContent('장면 해설을 만드는 중이에요, 81퍼센트.'))
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
  // 서버 54 → 화면 81 그대로라 같은 10% 구간: 다시 읽지 않는다
  expect(band()).toHaveTextContent('장면 해설을 만드는 중이에요, 81퍼센트.')

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
  await waitFor(() => expect(band()).toHaveTextContent('해설 음성을 만드는 중이에요, 92퍼센트.'))
  expect(steps()).toEqual([
    '영상 업로드, 완료',
    '영상 분석, 완료',
    '장면 해설 만들기, 완료',
    '해설 합치고 다듬기, 완료',
    '해설 음성 만들기, 진행 중',
  ])

  vi.mocked(jobsApi.get).mockResolvedValue(
    job({
      status: 'SUCCEEDED',
      progress: 100,
      descriptionId: 20,
      finishedAt: '2026-11-02T01:02:12Z',
    }),
  )
  // 해설이 생겼으니 영상 정보도 바뀐다 (완료 시 다시 받는다. 시청 화면이 해설 없음으로 보고 되돌려보내지 않게)
  vi.mocked(videosApi.get).mockResolvedValue({ ...video, descriptionId: 20, activeJobId: null })
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

  // 해설이 생겼으니 영상 정보도 바뀐다 (시청 화면이 해설 없음으로 보고 되돌려보내지 않게)
  vi.mocked(videosApi.get).mockResolvedValue({ ...video, descriptionId: 20, activeJobId: null })
  await user.click(within(dialog).getByRole('button', { name: '지금 보기' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/watch/15'))
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

test('남은 시간은 1초마다 줄고, 조금 늘어난 값이 와도 되올라가지 않는다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    vi.mocked(jobsApi.get).mockResolvedValue(job({ estimatedRemainingSec: 37 }))
    renderRoute('/jobs/51')
    expect(await screen.findByText('약 37초 남았어요')).toBeInTheDocument()
    await waitFor(() => expect(subscribeSse).toHaveBeenCalled())

    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(screen.getByText(/약 3[34]초 남았어요/)).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(12_000))
    act(() =>
      sse().onMessage({
        event: 'progress',
        data: JSON.stringify({
          status: 'RUNNING',
          currentStage: 'DESCRIBE',
          progress: 50,
          estimatedRemainingSec: 24,
        }),
      }),
    )
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    // 화면은 21~22초 — 서버 24초로 되올라가지 않는다
    expect(screen.getByText(/약 2[12]초 남았어요/)).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

test('서버 예상 시간이 오면 진행률을 남은 시간과 같은 예측으로 그리고, 예상이 늘어도 뒤로 가지 않는다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    vi.mocked(jobsApi.get).mockResolvedValue(
      job({
        currentStage: 'PREPARE',
        progress: 10,
        estimatedTotalSec: 100,
        estimatedRemainingSec: 40,
      }),
    )
    renderRoute('/jobs/51')
    expect(await screen.findByText('약 40초 남았어요')).toBeInTheDocument()
    // 서버 진행률(10, 분석 중)이 아니라 남은 시간 기준 60% (화면에서 1초씩 세므로 조금 더 클 수 있음)
    const now = () => Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))
    expect(now()).toBeGreaterThanOrEqual(60)
    expect(now()).toBeLessThan(75)
    await waitFor(() => expect(subscribeSse).toHaveBeenCalled())

    // 분석이 길어져 서버 예상이 200초로 늘어도 막대는 60 아래로 가지 않는다
    act(() =>
      sse().onMessage({
        event: 'progress',
        data: JSON.stringify({
          status: 'RUNNING',
          currentStage: 'PREPARE',
          progress: 10,
          estimatedRemainingSec: 150,
          estimatedTotalSec: 200,
        }),
      }),
    )
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(now()).toBeGreaterThanOrEqual(60)
  } finally {
    vi.useRealTimers()
  }
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

test('유튜브 영상: 영상 업로드 없이 4단계, 서버 진행률을 그대로 보여 준다', async () => {
  vi.mocked(videosApi.get).mockResolvedValue({
    ...video,
    sourceType: 'YOUTUBE',
    youtubeVideoId: 'abcdEFGhijk',
  })
  vi.mocked(jobsApi.get).mockResolvedValue(
    job({ currentStage: 'PREPARE', progress: 10, startedAt: null }),
  )
  renderRoute('/jobs/51')
  await screen.findByRole('heading', { level: 1, name: '해설을 만들고 있어요' })
  // 서버 10(PREPARE 0~20의 절반) → 화면 37.5(0~75의 절반). 유튜브는 업로드 몫이 없다
  expect(screen.getByRole('progressbar', { name: '해설 만들기 진행률' })).toHaveAttribute(
    'aria-valuenow',
    '37',
  )
  expect(steps()).toEqual([
    '영상 분석, 진행 중',
    '장면 해설 만들기, 대기',
    '해설 합치고 다듬기, 대기',
    '해설 음성 만들기, 대기',
  ])
  await waitFor(() => expect(band()).toHaveTextContent('영상을 분석하는 중이에요, 37퍼센트.'))
})

test('실패하면 멈춘 단계를 멈춤으로 보여 준다', async () => {
  vi.mocked(jobsApi.get).mockResolvedValue(
    job({
      status: 'FAILED',
      currentStage: 'MERGE',
      progress: 72,
      errorCode: 'UNKNOWN',
      retryable: true,
    }),
  )
  renderRoute('/jobs/51')
  await screen.findByRole('heading', { level: 1, name: '해설을 만들지 못했어요' })
  expect(steps()).toEqual([
    '영상 업로드, 완료',
    '영상 분석, 완료',
    '장면 해설 만들기, 완료',
    '해설 합치고 다듬기, 멈춤',
    '해설 음성 만들기, 대기',
  ])
})
