import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { videosApi } from '@/api/videos'
import { favoritesApi } from '@/api/favorites'
import { jobsApi } from '@/api/jobs'
import { ApiError } from '@/api/errors'
import {
  DEFAULT_SETTINGS,
  type FavoriteVideo,
  type MyVideo,
  type Paged,
  type VideoDetail,
} from '@/api/types'
import { renderRoute } from '@/test/renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  reissueAccessToken: vi.fn(),
}))
vi.mock('@/api/users', () => ({
  usersApi: {
    me: vi.fn(),
    settings: vi.fn(),
    updateSettings: vi.fn(),
    quota: vi.fn(),
    myVideos: vi.fn(),
  },
}))
vi.mock('@/api/videos', () => ({
  videosApi: { get: vi.fn(), list: vi.fn(), retry: vi.fn(), updateVisibility: vi.fn() },
}))
vi.mock('@/api/favorites', () => ({
  favoritesApi: { list: vi.fn(), add: vi.fn(), remove: vi.fn() },
}))
vi.mock('@/api/jobs', () => ({ jobsApi: { get: vi.fn(), streamPath: vi.fn() } }))
vi.mock('@/api/sse', () => ({ subscribeSse: vi.fn().mockResolvedValue(undefined) }))

const mine = (id: number, patch: Partial<MyVideo> = {}): MyVideo => ({
  videoId: id,
  sourceType: 'YOUTUBE',
  title: `영상 ${id}`,
  thumbnailUrl: null,
  durationSec: 282,
  category: 'EDUCATION',
  available: true,
  descriptionStatus: 'READY',
  jobId: null,
  requestedAt: '2026-11-02T00:00:00Z',
  ...patch,
})
const saved = (id: number, patch: Partial<FavoriteVideo> = {}): FavoriteVideo => ({
  videoId: id,
  sourceType: 'YOUTUBE',
  title: `즐겨찾기 영상 ${id}`,
  thumbnailUrl: null,
  durationSec: 282,
  category: 'EDUCATION',
  available: true,
  hasDescription: true,
  favoritedAt: '2026-11-02T00:00:00Z',
  ...patch,
})
function paged<T>(content: T[], page = 0, size = 4): Paged<T> {
  return {
    content: content.slice(page * size, (page + 1) * size),
    page: {
      number: page,
      size,
      totalElements: content.length,
      totalPages: Math.ceil(content.length / size),
      first: page === 0,
      last: (page + 1) * size >= content.length,
    },
  }
}
function detail(id: number, patch: Partial<VideoDetail> = {}): VideoDetail {
  return {
    videoId: id,
    sourceType: 'YOUTUBE',
    title: `영상 ${id}`,
    channelTitle: '수학하는 민쌤',
    thumbnailUrl: null,
    durationSec: 282,
    category: 'EDUCATION',
    isFavorite: false,
    youtubeVideoId: 'Zk81PqaTn0c',
    visibility: 'PUBLIC',
    status: 'REGISTERED',
    isOwner: false,
    descriptionId: id,
    activeJobId: null,
    ...patch,
  }
}
let myItems: MyVideo[]
let favoriteItems: FavoriteVideo[]

beforeEach(() => {
  vi.clearAllMocks()
  myItems = [
    mine(1),
    mine(2, { sourceType: 'UPLOAD' }),
    mine(3, { sourceType: 'UPLOAD' }),
    mine(4, { descriptionStatus: 'FAILED' }),
  ]
  favoriteItems = [saved(5), saved(6, { hasDescription: false }), saved(7, { available: false })]
  vi.mocked(reissueAccessToken).mockResolvedValue('test-token')
  vi.mocked(usersApi.me).mockResolvedValue({
    userId: 1,
    email: 'test@example.com',
    name: '김하늘',
    role: 'VISUALLY_IMPAIRED',
    verified: true,
    verifiedAt: null,
    createdAt: '2026-10-20T00:00:00Z',
  })
  vi.mocked(usersApi.settings).mockResolvedValue({ ...DEFAULT_SETTINGS, tutorialCompleted: true })
  vi.mocked(usersApi.quota).mockResolvedValue({
    role: 'VISUALLY_IMPAIRED',
    date: '2026-11-02',
    youtube: { maxDurationSec: 3600, limit: 5, used: 1, remaining: 4 },
    upload: { maxDurationSec: 3600, maxSizeBytes: 500000000, limit: 3, used: 0, remaining: 3 },
  })
  vi.mocked(usersApi.myVideos).mockImplementation(async (page = 0, size = 20) =>
    paged(myItems, page, size),
  )
  vi.mocked(favoritesApi.list).mockImplementation(async (page = 0, size = 4) =>
    paged(favoriteItems, page, size),
  )
  vi.mocked(videosApi.list).mockResolvedValue(paged([]))
  vi.mocked(videosApi.get).mockImplementation(async (id) =>
    detail(
      id,
      id === 2
        ? { sourceType: 'UPLOAD', isOwner: true }
        : id === 3
          ? { sourceType: 'UPLOAD', isOwner: false }
          : id === 4 || id === 6
            ? { descriptionId: null }
            : {},
    ),
  )
  vi.mocked(favoritesApi.remove).mockImplementation(async (id) => {
    favoriteItems = favoriteItems.filter((v) => v.videoId !== id)
    return { videoId: id, isFavorite: false }
  })
  vi.mocked(videosApi.updateVisibility).mockImplementation(async (id, visibility) => ({
    videoId: id,
    visibility,
  }))
})

test('내 영상은 한 열 목록으로 10개씩 받고 제목에 초점을 두며 카드·횟수·상태를 읽을 수 있다', async () => {
  const { container } = renderRoute('/me/videos')
  const title = await screen.findByRole('heading', { level: 1, name: '내 영상' })
  await waitFor(() => expect(title).toHaveFocus())
  const list = await screen.findByRole('list', { name: '요청·올린 영상' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(4)
  expect(list.tagName).toBe('OL')
  expect(usersApi.myVideos).toHaveBeenCalledWith(0, 10)
  expect(favoritesApi.list).toHaveBeenCalledWith(0, 10)
  expect(await screen.findByRole('link', { name: '재생, 영상 1' })).toHaveAttribute(
    'href',
    '/watch/1',
  )
  expect((await screen.findAllByText('유튜브 · 수학하는 민쌤')).length).toBeGreaterThan(0)
  expect(screen.getByText('5번 중 4번 남음')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '다시 요청, 영상 4' })).toBeInTheDocument()
  // 4개뿐이라 더 보기는 없다 (쪽 번호도 없다)
  expect(screen.queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: '페이지' })).not.toBeInTheDocument()
  expect(await axe(container)).toHaveNoViolations()
})

test('화살표로 즐겨찾기 탭을 열고 재생 불가 영상도 해제할 수 있다', async () => {
  const user = userEvent.setup()
  const { container } = renderRoute('/me/videos')
  const first = await screen.findByRole('tab', { name: '요청·올린 영상 4' })
  await user.click(first)
  await user.keyboard('{ArrowRight}')
  expect(await screen.findByRole('tab', { name: '즐겨찾기 3' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const unavailable = await screen.findByRole('button', { name: '재생 불가, 즐겨찾기 영상 7' })
  expect(unavailable).toHaveAttribute('aria-disabled', 'true')
  expect(await axe(container)).toHaveNoViolations()
  await user.click(screen.getByRole('button', { name: '즐겨찾기 해제, 즐겨찾기 영상 7' }))
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: '즐겨찾기 영상 7' })).not.toBeInTheDocument(),
  )
  expect(favoritesApi.remove).toHaveBeenCalledWith(7)
  expect(screen.getByRole('heading', { name: '즐겨찾기 영상', level: 2 })).toHaveFocus()
  expect(await screen.findByRole('tab', { name: '즐겨찾기 2' })).toBeInTheDocument()
})

test('즐겨찾기 해제가 실패하면 카드를 유지하고 오류를 안내한다', async () => {
  vi.mocked(favoritesApi.remove).mockRejectedValue(new ApiError('COMMON_004', 500, ''))
  renderRoute('/me/videos?tab=favorites')
  await userEvent.click(
    await screen.findByRole('button', { name: '즐겨찾기 해제, 즐겨찾기 영상 5' }),
  )
  await waitFor(() =>
    expect(screen.getAllByText(/즐겨찾기를 해제하지 못했어요/).length).toBeGreaterThan(0),
  )
  expect(screen.getByRole('heading', { name: '즐겨찾기 영상 5' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '즐겨찾기 3' })).toBeInTheDocument()
})

test('본인 업로드만 공개 범위 버튼을 제공하고 실제 응답으로 이름을 바꾼다', async () => {
  renderRoute('/me/videos')
  const button = await screen.findByRole('button', { name: '비공개로, 영상 2' })
  expect(screen.queryByRole('button', { name: '비공개로, 영상 3' })).not.toBeInTheDocument()
  await userEvent.click(button)
  expect(videosApi.updateVisibility).toHaveBeenCalledWith(2, 'PRIVATE')
  expect(await screen.findByRole('button', { name: '공개로, 영상 2' })).toBeInTheDocument()
  expect(screen.getByText('직접 올린 영상 · 비공개')).toBeInTheDocument()
})

test('공개 범위 변경 실패 시 기존 공개 상태와 버튼을 유지한다', async () => {
  vi.mocked(videosApi.updateVisibility).mockRejectedValue(new ApiError('COMMON_003', 403, ''))
  renderRoute('/me/videos')
  await userEvent.click(await screen.findByRole('button', { name: '비공개로, 영상 2' }))
  await waitFor(() =>
    expect(screen.getAllByText(/공개 범위를 바꾸지 못했어요/).length).toBeGreaterThan(0),
  )
  expect(screen.getByRole('button', { name: '비공개로, 영상 2' })).toBeInTheDocument()
})

test('실패한 해설을 다시 요청하면 반환된 작업 화면으로 이동한다', async () => {
  vi.mocked(videosApi.retry).mockResolvedValue({
    videoId: 4,
    jobId: 99,
    result: 'NEW_JOB',
    counted: false,
    retryRemainingToday: 2,
  })
  vi.mocked(jobsApi.get).mockResolvedValue({
    jobId: 99,
    videoId: 4,
    jobType: 'GENERATE',
    status: 'QUEUED',
    currentStage: null,
    progress: 0,
    estimatedRemainingSec: null,
    estimatedTotalSec: null,
    descriptionId: null,
    coveredUntilMs: null,
    errorCode: null,
    retryable: null,
    queuedAt: '2026-11-02T00:00:00Z',
    startedAt: null,
    finishedAt: null,
  })
  const { router } = renderRoute('/me/videos')
  await userEvent.click(await screen.findByRole('button', { name: '다시 요청, 영상 4' }))
  expect(videosApi.retry).toHaveBeenCalledWith(4)
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/99'))
})

test('진행 중인 해설은 작업 링크를 제공한다', async () => {
  myItems = [mine(9, { descriptionStatus: 'GENERATING', jobId: 45 })]
  renderRoute('/me/videos')
  expect(await screen.findByRole('link', { name: '진행 상황 보기, 영상 9' })).toHaveAttribute(
    'href',
    '/jobs/45',
  )
})

test('더 보기는 10개씩 이어 붙이고 새 첫 영상 제목으로 초점을 옮긴다', async () => {
  for (let id = 11; id <= 23; id++) myItems.push(mine(id))
  const { router } = renderRoute('/me/videos')
  await screen.findByRole('link', { name: '재생, 영상 1' })
  expect(screen.queryByRole('heading', { name: '영상 17' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '더 보기 (7개 남음)' }))
  // 11번째 줄 = 영상 17 (앞 10줄: 영상 1~4, 11~16)
  const eleventh = await screen.findByRole('heading', { name: '영상 17' })
  await waitFor(() => expect(eleventh).toHaveFocus())
  expect(usersApi.myVideos).toHaveBeenLastCalledWith(0, 20)
  expect(router.state.location.search).toBe('?shown=20')
  expect(
    (await screen.findAllByText('7개 더 불러왔어요. 전체 17개 중 17개. 모든 영상을 불러왔어요.'))
      .length,
  ).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument()
})

test('즐겨찾기를 해제하면 목록에서 빠지고 개수가 줄어든다', async () => {
  favoriteItems = [saved(11), saved(12), saved(13), saved(14), saved(15)]
  renderRoute('/me/videos?tab=favorites')
  await userEvent.click(
    await screen.findByRole('button', { name: '즐겨찾기 해제, 즐겨찾기 영상 15' }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: '즐겨찾기 영상 15' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('heading', { name: '즐겨찾기 영상 11' })).toBeInTheDocument()
  expect(await screen.findByRole('tab', { name: '즐겨찾기 4' })).toBeInTheDocument()
})

test('내 영상이 비어 있으면 홈과 영상 등록으로 이동할 수 있다', async () => {
  myItems = []
  const { container } = renderRoute('/me/videos')
  expect(await screen.findByRole('heading', { name: '아직 영상이 없어요' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '영상 등록하기' })).toHaveAttribute('href', '/register')
  expect(screen.getByRole('link', { name: '해설 있는 영상 보기' })).toHaveAttribute('href', '/')
  expect(await axe(container)).toHaveNoViolations()
})

test('목록을 불러오지 못하면 다시 불러오기 후 복구할 수 있다', async () => {
  vi.mocked(usersApi.myVideos).mockRejectedValueOnce(new ApiError('COMMON_004', 500, ''))
  renderRoute('/me/videos')
  await userEvent.click(await screen.findByRole('button', { name: '다시 불러오기' }))
  expect(await screen.findByRole('link', { name: '재생, 영상 1' })).toBeInTheDocument()
})

test('해설 없는 유튜브 즐겨찾기는 주소 확인 화면을 거쳐 해설을 요청한다', async () => {
  renderRoute('/me/videos?tab=favorites')
  const link = await screen.findByRole('link', { name: '해설 만들기, 즐겨찾기 영상 6' })
  expect(link).toHaveAttribute(
    'href',
    `/search/youtube?url=${encodeURIComponent('https://www.youtube.com/watch?v=Zk81PqaTn0c')}`,
  )
})
