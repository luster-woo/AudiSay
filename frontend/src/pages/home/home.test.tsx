import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { videosApi } from '@/api/videos'
import { jobsApi } from '@/api/jobs'
import { sttApi } from '@/api/stt'
import { ApiError } from '@/api/errors'
import { chatApi } from '@/api/chat'
import {
  DEFAULT_SETTINGS,
  type Job,
  type Quota,
  type VideoSummary,
  type YoutubeCheck,
  type YoutubeSearchItem,
} from '@/api/types'
import { renderRoute } from '@/test/renderWithProviders'
import { screenReaderLeadMs } from '@/features/search/speechLead'

// '띠' 전 기다림은 테스트에서 0 (기다림 자체는 아래 '안내 → 띠 → 녹음' 테스트에서 따로 본다)
vi.mock('@/features/search/speechLead', () => ({ screenReaderLeadMs: vi.fn(() => 0) }))

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
vi.mock('@/api/videos', () => ({
  videosApi: {
    list: vi.fn(),
    youtubeSearch: vi.fn(),
    youtubeCheck: vi.fn(),
    youtubeRequest: vi.fn(),
    retry: vi.fn(),
  },
}))
vi.mock('@/api/favorites', () => ({ favoritesApi: { add: vi.fn(), remove: vi.fn() } }))
vi.mock('@/api/jobs', () => ({
  jobsApi: { get: vi.fn(), streamPath: (id: number) => `/jobs/${id}/stream` },
}))
// 검색 결과 → 확인 화면 → 해설 만들기 흐름이 /jobs/:id 까지 가므로 SSE 는 열지 않게 막는다
vi.mock('@/api/sse', () => ({ subscribeSse: vi.fn() }))
vi.mock('@/api/stt', () => ({ sttApi: { transcribe: vi.fn() } }))
vi.mock('@/api/chat', () => ({ chatApi: { send: vi.fn() } }))

const video = (id: number, title: string, isFavorite = false): VideoSummary => ({
  videoId: id,
  sourceType: 'YOUTUBE',
  title,
  channelTitle: '채널',
  thumbnailUrl: null,
  durationSec: 425,
  category: 'COOKING',
  isFavorite,
})
const quota = (remaining = 4): Quota => ({
  role: 'VISUALLY_IMPAIRED',
  date: '2026-11-01',
  youtube: { maxDurationSec: 3600, limit: 5, used: 5 - remaining, remaining },
  upload: { maxDurationSec: 3600, maxSizeBytes: 1, limit: 3, used: 0, remaining: 3 },
})
const check = (patch: Partial<YoutubeCheck> = {}): YoutubeCheck => ({
  youtubeVideoId: 'Zk81PqaTn0c',
  title: '김치볶음밥, 10분이면 충분해요',
  channelTitle: '자취요리 일기',
  thumbnailUrl: null,
  durationSec: 425,
  available: true,
  rejectReason: null,
  videoId: 12,
  descriptionStatus: 'READY',
  willCount: false,
  ...patch,
})
const searchItem = (patch: Partial<YoutubeSearchItem>): YoutubeSearchItem => ({
  youtubeVideoId: 'aaaaaaaaaaa',
  title: '영상',
  channelTitle: '채널',
  thumbnailUrl: null,
  durationSec: 282,
  hasDescription: false,
  videoId: null,
  ...patch,
})

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
  vi.mocked(usersApi.quota).mockResolvedValue(quota())
  vi.mocked(usersApi.myVideos).mockResolvedValue({
    content: [],
    page: { number: 0, size: 20, totalElements: 0, totalPages: 0, first: true, last: true },
  })
  vi.mocked(videosApi.list).mockResolvedValue({
    content: [
      video(1, '김치볶음밥, 10분이면 충분해요', true),
      video(2, '처음 보는 프로야구 규칙 5분 정리'),
      video(3, '아이폰 손쉬운 사용 설정 따라하기'),
      { ...video(4, '화면 녹화 중'), sourceType: 'UPLOAD', channelTitle: '' },
    ],
    page: { number: 0, size: 4, totalElements: 48, totalPages: 12, first: true, last: false },
  })
})

describe('홈', () => {
  test('검색 칸에 포커스, 영상 수를 읽고, 카드는 제목이 들어간 링크 하나다', async () => {
    const { container } = renderRoute('/')
    const search = await screen.findByRole('searchbox', { name: '검색어나 유튜브 주소로 찾기' })
    await waitFor(() => expect(search).toHaveFocus())
    expect(
      (await screen.findAllByText('홈이에요. 검색 칸에 있어요. 해설이 준비된 영상 48개.')).length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('search', { name: '영상 찾기' })).toBeInTheDocument()

    const section = screen.getByRole('region', { name: '해설이 준비된 영상' })
    // 한 열 번호 목록
    const list = within(section).getByRole('list')
    expect(list.tagName).toBe('OL')
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    // 줄 하나 = 링크 하나. 링크 이름은 제목만, 출처·길이는 설명으로 이어 읽는다. h3 로 제목 탐색도 된다
    const row = screen.getByRole('link', { name: '김치볶음밥, 10분이면 충분해요' })
    expect(row).toHaveAccessibleDescription('유튜브 · 채널 · 7분 05초')
    expect(screen.getByRole('link', { name: '화면 녹화 중' })).toHaveAccessibleDescription(
      '직접 올린 영상 · 7분 05초',
    )
    expect(row).toHaveAttribute('href', '/watch/1')
    // 제목(h3)이 링크를 감싼다 (링크 안의 h3 는 크롬이 제목 탐색에서 숨긴다)
    expect(row.closest('h3')).toHaveTextContent('김치볶음밥, 10분이면 충분해요')
    expect(screen.queryByRole('button', { name: /재생|즐겨찾기/ })).not.toBeInTheDocument()
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent(
      '해설이 준비된 영상48개',
    )
    // 처음엔 10개를 달라고 한다. 쪽 번호 대신 '더 보기'
    expect(videosApi.list).toHaveBeenCalledWith({ category: undefined, page: 0, size: 10 })
    expect(screen.queryByRole('navigation', { name: '페이지' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '더 보기 (44개 남음)' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  test('더 보기: 10개씩 이어 붙이고 새 첫 영상으로 포커스, 다 불러오면 알리고 버튼을 없앤다', async () => {
    const all = Array.from({ length: 15 }, (_, i) => video(i + 1, `영상 ${i + 1}`))
    vi.mocked(videosApi.list).mockImplementation(async ({ page = 0, size = 20 }) => ({
      content: all.slice(page * size, page * size + size),
      page: {
        number: page,
        size,
        totalElements: all.length,
        totalPages: Math.ceil(all.length / size),
        first: page === 0,
        last: (page + 1) * size >= all.length,
      },
    }))
    const { router } = renderRoute('/')
    await screen.findByRole('link', { name: '영상 10' })
    expect(screen.queryByRole('link', { name: '영상 11' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '더 보기 (5개 남음)' }))
    const eleventh = await screen.findByRole('link', { name: '영상 11' })
    await waitFor(() => expect(eleventh).toHaveFocus())
    expect(videosApi.list).toHaveBeenLastCalledWith({ category: undefined, page: 0, size: 20 })
    expect(
      (await screen.findAllByText('5개 더 불러왔어요. 전체 15개 중 15개. 모든 영상을 불러왔어요.'))
        .length,
    ).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument()
    // 불러온 개수를 주소에 남겨, 영상을 보고 돌아오면 그대로
    expect(router.state.location.search).toBe('?shown=20')
    await router.navigate('/watch/1')
    await router.navigate('/?shown=20')
    expect(await screen.findByRole('link', { name: '영상 15' })).toBeInTheDocument()
  })

  test('검색어는 검색 결과로, 유튜브 주소는 주소 확인으로 간다', async () => {
    vi.mocked(videosApi.youtubeSearch).mockResolvedValue({ items: [], nextPageToken: null })
    vi.mocked(videosApi.youtubeCheck).mockResolvedValue(check())
    const { router } = renderRoute('/')
    const search = await screen.findByRole('searchbox', { name: '검색어나 유튜브 주소로 찾기' })
    await userEvent.type(search, '그래프 읽는 법{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'))
    expect(router.state.location.search).toBe(`?q=${encodeURIComponent('그래프 읽는 법')}`)

    await router.navigate('/')
    const again = await screen.findByRole('searchbox', { name: '검색어나 유튜브 주소로 찾기' })
    await userEvent.clear(again)
    await userEvent.type(again, 'https://youtu.be/Zk81PqaTn0c{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/search/youtube'))
  })

  test('만드는 중인 해설이 있으면 진행률 카드가 보인다', async () => {
    vi.mocked(usersApi.myVideos).mockResolvedValue({
      content: [
        {
          videoId: 9,
          sourceType: 'UPLOAD',
          title: '3주차 물리 실험 진자의 주기',
          thumbnailUrl: null,
          durationSec: 300,
          category: null,
          available: true,
          descriptionStatus: 'GENERATING',
          jobId: 31,
          requestedAt: '2026-11-01T00:00:00Z',
        },
      ],
      page: { number: 0, size: 20, totalElements: 1, totalPages: 1, first: true, last: true },
    })
    vi.mocked(jobsApi.get).mockResolvedValue({
      jobId: 31,
      status: 'RUNNING',
      progress: 62,
      estimatedRemainingSec: 70,
    } as Job)
    renderRoute('/')
    expect(
      await screen.findByRole('link', {
        // 업로드 영상: 서버 62 → 화면 79.2 → 업로드 몫 15 + 79.2 × 0.85 = 82 (해설 만들기 화면과 같은 계산)
        name: '해설 만드는 중, 3주차 물리 실험 진자의 주기, 82%, 약 1분 남음',
      }),
    ).toHaveAttribute('href', '/jobs/31')
  })
})

describe('음성 검색', () => {
  class FakeRecorder {
    state = 'inactive'
    mimeType = 'audio/webm'
    stream = { getTracks: () => [{ stop: vi.fn() }] }
    ondataavailable: ((e: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    start() {
      this.state = 'recording'
    }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob(['x']) })
      this.onstop?.()
    }
  }

  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({}) },
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined })
  })

  /** 마이크 권한 상태를 정한다. change() 로 상태를 바꾸면 change 이벤트를 낸다 */
  function micPermission(initial: PermissionState) {
    const status = Object.assign(new EventTarget(), { state: initial })
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue(status) },
    })
    return {
      change(next: PermissionState) {
        status.state = next
        status.dispatchEvent(new Event('change'))
      },
    }
  }
  const denyMic = (name: string) =>
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('x', name)) },
    })

  test('안내 → 낭독기가 읽는 동안 기다림 → 띠 → 녹음 순서로 시작한다', async () => {
    vi.mocked(screenReaderLeadMs).mockReturnValueOnce(300)
    const startSpy = vi.spyOn(FakeRecorder.prototype, 'start')
    renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: '음성 검색' }))
    // 기다리는 동안: 포커스는 말 끝내기(아직 못 누름), 녹음 전
    const finish = await screen.findByRole('button', { name: '말 끝내기' })
    expect(finish).toHaveFocus()
    expect(finish).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText("곧 '띠' 소리가 나요")).toBeInTheDocument()
    expect(startSpy).not.toHaveBeenCalled()
    // 기다림이 끝나면 녹음 시작
    expect(await screen.findByText('듣고 있어요')).toBeInTheDocument()
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(finish).not.toHaveAttribute('aria-disabled')
    startSpy.mockRestore()
  })

  test('듣는 중 → 말 끝내기 → 알아들은 말로 검색한다', async () => {
    vi.mocked(sttApi.transcribe).mockResolvedValue({ text: '그래프 읽는 법', latencyMs: 1 })
    const { router } = renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: '음성 검색' }))
    const finish = await screen.findByRole('button', { name: '말 끝내기' })
    expect(finish).toHaveFocus()
    expect(screen.getByText('듣고 있어요')).toBeInTheDocument()
    await userEvent.keyboard(' ')
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'))
  })

  test('"~ 영상 찾아 줘"는 챗봇이 뽑은 검색어로 검색한다', async () => {
    localStorage.removeItem('audisay.voiceSearchTipCount')
    vi.mocked(sttApi.transcribe).mockResolvedValue({ text: '고양이 영상 찾아 줘', latencyMs: 1 })
    vi.mocked(chatApi.send).mockResolvedValue({
      chatLogId: 1,
      inputMode: 'VOICE',
      utterance: '고양이 영상 찾아 줘',
      intent: 'SEARCH_VIDEO',
      result: { query: '고양이' },
    })
    const { router } = renderRoute('/')
    const voiceButton = await screen.findByRole('button', { name: '음성 검색' })
    expect(voiceButton).toHaveAccessibleDescription(
      '음성으로는 "고양이 영상 찾아 줘"처럼 말해도 돼요.',
    )
    await userEvent.click(voiceButton)
    // 처음 몇 번은 듣기 시작 안내에 부가 기능을 함께 읽는다
    expect(await screen.findByText(/"고양이 영상 찾아 줘"처럼 문장으로 말해도 돼요/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: '말 끝내기' }))
    await waitFor(() => expect(router.state.location.search).toBe('?q=%EA%B3%A0%EC%96%91%EC%9D%B4'))
    expect(chatApi.send).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: null,
        utterance: '고양이 영상 찾아 줘',
        inputMode: 'VOICE',
      }),
    )
  })

  test('말로 한 설정 변경은 검색하지 않고 설정을 바꾼다', async () => {
    vi.mocked(sttApi.transcribe).mockResolvedValue({ text: '말 빠르게', latencyMs: 1 })
    vi.mocked(chatApi.send).mockResolvedValue({
      chatLogId: 2,
      inputMode: 'VOICE',
      utterance: '말 빠르게',
      intent: 'SETTING',
      result: { settingKey: 'speechRate', settingValue: '1.5' },
    })
    vi.mocked(usersApi.updateSettings).mockImplementation(async (patch) => ({
      ...(await usersApi.settings()),
      ...patch,
    }))
    const { router } = renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: '음성 검색' }))
    await userEvent.click(await screen.findByRole('button', { name: '말 끝내기' }))
    await waitFor(() => expect(usersApi.updateSettings).toHaveBeenCalledWith({ speechRate: 1.5 }))
    expect(router.state.location.pathname).toBe('/')
  })

  test('알아듣지 못하면 다시 말하기에 포커스, 글자로 찾기는 검색 칸으로', async () => {
    vi.mocked(sttApi.transcribe).mockRejectedValue(new ApiError('CHAT_001', 422, ''))
    renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: '음성 검색' }))
    await userEvent.click(await screen.findByRole('button', { name: '말 끝내기' }))
    expect(await screen.findByRole('button', { name: '다시 말하기' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: '글자로 찾기' }))
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: '검색어나 유튜브 주소로 찾기' })).toHaveFocus(),
    )
  })

  test('마이크를 쓸 수 없으면 이유와 글자 입력 방법을 알린다', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: '음성 검색' }))
    expect(
      (
        await screen.findAllByText(
          '이 브라우저에서는 음성 입력을 쓸 수 없어요. 글자로 찾기는 그대로 쓸 수 있어요. 검색 칸에 있어요.',
        )
      ).length,
    ).toBeGreaterThan(0)
  })
  test('마이크를 처음 쓰면 허용 팝업이 뜬다고 먼저 알리고, 허용하면 바로 듣는다', async () => {
    micPermission('prompt')
    renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: '음성 검색' }))
    expect(
      (await screen.findAllByText(/브라우저가 마이크를 써도 되는지 물어봐요/)).length,
    ).toBeGreaterThan(0)
    expect(await screen.findByRole('button', { name: '말 끝내기' })).toHaveFocus()
  })

  test('마이크가 막혀 있으면 푸는 방법을 알리고, 사이트 설정에서 허용하면 바로 알려 준다', async () => {
    const perm = micPermission('denied')
    denyMic('NotAllowedError')
    renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: '음성 검색' }))
    expect(
      (await screen.findAllByText(/마이크가 막혀 있어요. 주소창 왼쪽의 자물쇠/)).length,
    ).toBeGreaterThan(0)
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: '검색어나 유튜브 주소로 찾기' })).toHaveFocus(),
    )

    act(() => perm.change('granted'))
    expect(
      (await screen.findAllByText('이제 마이크를 쓸 수 있어요. 음성 검색을 다시 눌러 주세요.'))
        .length,
    ).toBeGreaterThan(0)
  })

  test('팝업을 그냥 닫으면 다시 누르면 다시 물어본다고 알린다', async () => {
    micPermission('prompt')
    denyMic('NotAllowedError')
    renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: '음성 검색' }))
    expect(
      (await screen.findAllByText(/마이크 사용을 허용하지 않았어요. 다시 누르면 다시 물어봐요./))
        .length,
    ).toBeGreaterThan(0)
  })

  test('마이크가 없거나 다른 프로그램이 쓰는 중이면 그 이유를 알린다', async () => {
    denyMic('NotFoundError')
    const { unmount } = renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: '음성 검색' }))
    expect((await screen.findAllByText(/마이크가 연결돼 있지 않아요/)).length).toBeGreaterThan(0)
    unmount()

    denyMic('NotReadableError')
    renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: '음성 검색' }))
    expect(
      (await screen.findAllByText(/다른 프로그램이 마이크를 쓰고 있어요/)).length,
    ).toBeGreaterThan(0)
  })
})

describe('검색 결과', () => {
  const threeResults = () =>
    vi.mocked(videosApi.youtubeSearch).mockResolvedValue({
      items: [
        searchItem({
          youtubeVideoId: 'a1',
          title: '그래프를 읽는 방법',
          hasDescription: true,
          videoId: 7,
        }),
        searchItem({ youtubeVideoId: 'b2', title: '엑셀 차트 기초' }),
        searchItem({ youtubeVideoId: 'c3', title: '통계 입문 전체 강의', durationSec: 4323 }),
      ],
      nextPageToken: null,
    })
  const openResults = async () => {
    const r = renderRoute(`/search?q=${encodeURIComponent('그래프 읽는 법')}`)
    const heading = await screen.findByRole('heading', { name: '검색 결과' })
    await waitFor(() => expect(heading).toHaveFocus())
    return r
  }

  test('홈과 같은 한 열 목록. 줄은 링크 하나: 해설 있으면 시청 화면, 없으면 주소 확인 화면. 버튼은 없다', async () => {
    threeResults()
    const { container } = await openResults()
    expect(
      (
        await screen.findAllByText(
          '"그래프 읽는 법" 검색 결과 3개. 해설 있는 영상 1개가 먼저 나와요.',
        )
      ).length,
    ).toBeGreaterThan(0)
    // 홈처럼 ol 한 열. 링크 이름은 제목만, 출처·길이·상태는 설명으로 이어 읽는다
    const section = screen.getByRole('region', { name: '검색 결과' })
    const list = within(section).getByRole('list')
    expect(list.tagName).toBe('OL')
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    const ready = screen.getByRole('link', { name: '그래프를 읽는 방법' })
    expect(ready).toHaveAttribute('href', '/watch/7')
    expect(ready).toHaveAccessibleDescription('유튜브 · 채널 · 4분 42초 해설 있음')
    expect(ready.closest('h3')).toHaveTextContent('그래프를 읽는 방법')
    const creatable = screen.getByRole('link', { name: '엑셀 차트 기초' })
    expect(creatable).toHaveAttribute(
      'href',
      `/search/youtube?url=${encodeURIComponent('https://youtu.be/b2')}`,
    )
    expect(creatable).toHaveAccessibleDescription('유튜브 · 채널 · 4분 42초 해설 만들 수 있어요')
    // 너무 긴 영상도 링크다 (확인 화면에서 이유와 다른 영상 찾기를 듣는다). 설명에 이유를 미리 넣는다
    const tooLong = screen.getByRole('link', { name: '통계 입문 전체 강의' })
    expect(tooLong).toHaveAttribute(
      'href',
      `/search/youtube?url=${encodeURIComponent('https://youtu.be/c3')}`,
    )
    expect(tooLong).toHaveAccessibleDescription(
      '유튜브 · 채널 · 72분 03초 해설 만들 수 없음, 60분 넘음',
    )
    expect(
      screen.queryByRole('button', { name: /재생|즐겨찾기|만들 수 없음/ }),
    ).not.toBeInTheDocument()
    expect(videosApi.youtubeCheck).not.toHaveBeenCalled()
    expect(videosApi.youtubeRequest).not.toHaveBeenCalled()
    expect(screen.getByRole('searchbox')).toHaveValue('그래프 읽는 법')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('해설이 없는 카드를 열면 주소 확인 화면에서 해설 만들기를 따로 누른다', async () => {
    threeResults()
    vi.mocked(videosApi.youtubeCheck).mockResolvedValue(
      check({ youtubeVideoId: 'b2', videoId: null, descriptionStatus: 'NONE', willCount: true }),
    )
    vi.mocked(videosApi.youtubeRequest).mockResolvedValue({
      videoId: 31,
      result: 'NEW_JOB',
      jobId: 77,
      descriptionId: null,
      counted: true,
      remaining: 3,
    })
    const { router } = await openResults()
    await userEvent.click(screen.getByRole('link', { name: '엑셀 차트 기초' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/search/youtube'))
    await screen.findByRole('heading', { level: 1, name: '해설을 만들 수 있어요' })
    expect(videosApi.youtubeCheck).toHaveBeenCalledWith('https://youtu.be/b2')
    expect(videosApi.youtubeRequest).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '해설 만들기' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/77'))
    expect(videosApi.youtubeRequest).toHaveBeenCalledWith('https://youtu.be/b2')
  })

  test('더 보기: 다음 쪽을 받아 10개씩 이어 붙이고 새 첫 영상으로 포커스, 다 받으면 버튼을 없앤다', async () => {
    const page = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) =>
        searchItem({ youtubeVideoId: `${prefix}${i + 1}`, title: `${prefix} ${i + 1}` }),
      )
    vi.mocked(videosApi.youtubeSearch).mockImplementation(async (_q, token) =>
      token === 'p2'
        ? { items: page('둘째', 5), nextPageToken: null }
        : { items: page('첫째', 10), nextPageToken: 'p2' },
    )
    const { router } = await openResults()
    expect(screen.getByText('전체 10개 넘게')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '첫째 10' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '페이지' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '더 보기' }))
    const eleventh = await screen.findByRole('link', { name: '둘째 1' })
    await waitFor(() => expect(eleventh).toHaveFocus())
    expect(videosApi.youtubeSearch).toHaveBeenLastCalledWith('그래프 읽는 법', 'p2')
    expect(
      (await screen.findAllByText('5개 더 불러왔어요. 15개까지 보여 줘요. 모든 영상을 불러왔어요.'))
        .length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('전체 15개')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument()
    // 보여 준 개수를 주소에 남겨, 영상을 보고 돌아오면 그대로
    expect(new URLSearchParams(router.state.location.search).get('shown')).toBe('20')
  })

  test('결과가 없으면 짧은 검색어 예시를 보여 주고 검색 칸으로 옮긴다', async () => {
    vi.mocked(videosApi.youtubeSearch).mockResolvedValue({ items: [], nextPageToken: null })
    renderRoute(`/search?q=${encodeURIComponent('삼각함수 그래프 이동 공식')}`)
    expect(await screen.findByRole('heading', { name: '찾는 영상이 없어요' })).toBeInTheDocument()
    expect(screen.getByText('예: ‘삼각함수 그래프’')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveFocus())
  })
})

describe('유튜브 주소 확인', () => {
  const route = (url = 'https://youtu.be/Zk81PqaTn0c') =>
    `/search/youtube?url=${encodeURIComponent(url)}`

  test('이미 해설이 있으면 바로 보기, 남은 횟수는 말로 읽힌다', async () => {
    vi.mocked(videosApi.youtubeCheck).mockResolvedValue(check())
    const { container } = renderRoute(route())
    const h1 = await screen.findByRole('heading', { level: 1, name: '이미 해설이 있는 영상이에요' })
    await waitFor(() => expect(h1).toHaveFocus())
    expect(screen.getByRole('link', { name: '바로 보기' })).toHaveAttribute('href', '/watch/12')
    expect(await screen.findByText('5번 중 4번 남음')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '유튜브 주소' })).toHaveValue(
      'https://youtu.be/Zk81PqaTn0c',
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  test('해설 만들기를 누르면 작업 화면으로 간다', async () => {
    vi.mocked(videosApi.youtubeCheck).mockResolvedValue(
      check({ descriptionStatus: 'NONE', willCount: true, videoId: null }),
    )
    vi.mocked(videosApi.youtubeRequest).mockResolvedValue({
      videoId: 12,
      result: 'NEW_JOB',
      jobId: 31,
      descriptionId: null,
      counted: true,
      remaining: 3,
    })
    const { router } = renderRoute(route())
    await screen.findByRole('heading', { level: 1, name: '해설을 만들 수 있어요' })
    await userEvent.click(screen.getByRole('button', { name: '해설 만들기' }))
    expect(videosApi.youtubeRequest).toHaveBeenCalledWith('https://youtu.be/Zk81PqaTn0c')
    await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/31'))
  })

  test('오늘 횟수를 다 썼으면 다른 영상 찾기', async () => {
    vi.mocked(usersApi.quota).mockResolvedValue(quota(0))
    vi.mocked(videosApi.youtubeCheck).mockResolvedValue(
      check({ descriptionStatus: 'NONE', willCount: true, videoId: null }),
    )
    renderRoute(route())
    expect(
      await screen.findByRole('heading', { level: 1, name: '오늘 해설 만들기 횟수를 다 썼어요' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '다른 영상 찾기' })).toHaveAttribute('href', '/')
    expect(screen.getAllByText('5번 중 0번 남음').length).toBeGreaterThan(0)
  })

  test('해설을 만들 수 있을 때도 버튼 줄 맨 끝에 다른 영상 찾기 링크가 있다', async () => {
    vi.mocked(videosApi.youtubeCheck).mockResolvedValue(
      check({ descriptionStatus: 'NONE', willCount: true, videoId: null }),
    )
    renderRoute(route())
    await screen.findByRole('heading', { level: 1, name: '해설을 만들 수 있어요' })
    const row = screen.getByRole('button', { name: '해설 만들기' }).parentElement!
    const items = [...row.querySelectorAll('a, button')]
    expect(items.map((el) => el.textContent)).toEqual([
      '해설 만들기',
      '이용 조건 보기',
      '다른 영상 찾기',
    ])
    expect(items[2]).toHaveAttribute('href', '/')
  })

  test('만들 수 없는 영상은 이유를 알리고, 이용 조건 창을 열고 닫을 수 있다', async () => {
    vi.mocked(videosApi.youtubeCheck).mockResolvedValue(
      check({
        available: false,
        rejectReason: 'NOT_EMBEDDABLE',
        descriptionStatus: 'NONE',
        videoId: null,
      }),
    )
    renderRoute(route())
    expect(
      await screen.findByRole('heading', { level: 1, name: '이 영상은 해설을 만들 수 없어요' }),
    ).toBeInTheDocument()
    expect(
      (await screen.findAllByText('다른 사이트에서 재생을 막은 영상이에요. 해설을 만들 수 없어요.'))
        .length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('횟수는 사용하지 않았어요.')).toBeInTheDocument()

    const open = screen.getByRole('button', { name: '이용 조건 보기' })
    await userEvent.click(open)
    const dialog = await screen.findByRole('dialog', { name: '해설을 만들 수 없는 영상' })
    expect(within(dialog).getByText('현재 등급의 길이 제한(60분)을 넘는 영상')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(open).toHaveFocus())
  })
})
