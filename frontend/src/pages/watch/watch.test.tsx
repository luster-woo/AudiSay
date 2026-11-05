import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { useEffect, useState } from 'react'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { videosApi } from '@/api/videos'
import { chatApi } from '@/api/chat'
import { reportsApi } from '@/api/reports'
import { favoritesApi } from '@/api/favorites'
import { subscribeSse, type SseOptions } from '@/api/sse'
import {
  DEFAULT_SETTINGS,
  type Description,
  type UserSettings,
  type VideoDetail,
} from '@/api/types'
import type { PlayerControls, PlayerState } from '@/features/player/usePlayerSource'
import { renderRoute } from '@/test/renderWithProviders'

/* ── 소리·영상은 jsdom 에 없으므로 흉내 낸다 ── */
let lastSaid: unknown = null
const say = vi.fn(async (item: unknown) => {
  lastSaid = item
  return true
})
const stopNarrator = vi.fn()
vi.mock('@/features/player/Narrator', () => ({
  Narrator: class {
    busy = false
    say = say
    stop = stopNarrator
    get last() {
      return lastSaid
    }
  },
  estimateSpeechMs: (t: string) => t.length * 180,
}))

/** 테스트가 재생 시각·상태를 직접 바꿀 수 있는 가짜 재생 소스 */
const controls: PlayerControls = {
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn(),
}
let setPlayerState: ((p: Partial<PlayerState>) => void) | null = null
vi.mock('@/features/player/usePlayerSource', () => ({
  usePlayerSource: (_p: unknown, durSec: number) => {
    const [state, setState] = useState<PlayerState>({
      ready: true,
      playing: false,
      ended: false,
      currentMs: 0,
      durationMs: durSec * 1000,
    })
    useEffect(() => {
      setPlayerState = (p) => setState((s) => ({ ...s, ...p }))
      return () => {
        setPlayerState = null
      }
    }, [])
    return { videoRef: { current: null }, ytHostRef: { current: null }, state, controls }
  },
}))

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
    get: vi.fn(),
    list: vi.fn(),
    playback: vi.fn(),
    description: vi.fn(),
    chapters: vi.fn(),
    summary: vi.fn(),
    sceneAt: vi.fn(),
    chatHistory: vi.fn(),
  },
}))
vi.mock('@/api/chat', () => ({
  chatApi: {
    send: vi.fn(),
    streamPath: (id: number, includeFuture = false) =>
      `/chat/messages/${id}/stream${includeFuture ? '?includeFuture=true' : ''}`,
  },
}))
vi.mock('@/api/reports', () => ({ reportsApi: { create: vi.fn() } }))
vi.mock('@/api/favorites', () => ({ favoritesApi: { add: vi.fn(), remove: vi.fn() } }))
vi.mock('@/api/sse', () => ({ subscribeSse: vi.fn() }))

const T = (s: number) => s * 1000
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
  descriptionId: 20,
  activeJobId: null,
}
const line = (lineId: number, idx: number, lv: 1 | 2 | 3, s: number, text: string) => ({
  lineId,
  lineIndex: idx,
  detailLevel: lv,
  startMs: T(s),
  gapEndMs: T(s + 6),
  importance: 2,
  text,
  audioUrl: null,
  audioDurationMs: null,
})
const description: Description = {
  descriptionId: 20,
  videoId: 15,
  status: 'PUBLISHED',
  coveredUntilMs: null,
  createdAt: '2026-11-01T00:00:00Z',
  lines: [
    // 상세도는 누적: 1단계 문장은 늘, 2단계는 '기본' 이상, 3단계는 '자세히'에서만 더해진다
    line(501, 1, 1, 8, '칠판이 보여요.'),
    line(502, 2, 2, 134, '세 개의 막대가 있는 그래프예요.'),
    line(503, 3, 3, 137, '가운데가 가장 높아요.'),
  ],
  scenes: [
    { sceneId: 1, sceneIndex: 1, title: '그래프란 무엇일까', startMs: 0, endMs: T(48) },
    { sceneId: 2, sceneIndex: 2, title: '막대그래프 비교', startMs: T(48), endMs: T(150) },
  ],
  dialogues: [],
  screenTexts: [],
}
const band = () => screen.getByRole('region', { name: '방금 안내', hidden: true })
const sse = () => vi.mocked(subscribeSse).mock.lastCall![1] as SseOptions

function mockAll(settings: Partial<UserSettings> = {}, v: Partial<VideoDetail> = {}) {
  vi.mocked(usersApi.settings).mockResolvedValue({
    ...DEFAULT_SETTINGS,
    tutorialCompleted: true,
    summaryMode: 'NEVER',
    ...settings,
  })
  vi.mocked(usersApi.updateSettings).mockImplementation(async (patch) => ({
    ...DEFAULT_SETTINGS,
    tutorialCompleted: true,
    summaryMode: 'NEVER',
    ...settings,
    ...patch,
  }))
  vi.mocked(videosApi.get).mockResolvedValue({ ...video, ...v })
  vi.mocked(videosApi.playback).mockResolvedValue({
    sourceType: 'UPLOAD',
    playbackUrl: 'https://s3/15.mp4',
    playbackFormat: 'MP4',
    expiresAt: null,
    youtubeVideoId: null,
  })
  vi.mocked(videosApi.description).mockResolvedValue(description)
  vi.mocked(videosApi.chapters).mockResolvedValue({
    descriptionId: 20,
    chapters: description.scenes.map((s) => ({
      chapterId: s.sceneId,
      chapterIndex: s.sceneIndex,
      title: s.title,
      startMs: s.startMs,
      endMs: s.endMs,
      summary: s.title,
    })),
  })
  vi.mocked(videosApi.summary).mockResolvedValue({
    descriptionId: 20,
    summary: { text: '그래프 수업 요약이에요.', audioUrl: null, durationMs: 3000 },
  })
  vi.mocked(videosApi.chatHistory).mockResolvedValue({
    messages: [],
    nextCursor: null,
    hasNext: false,
  })
  vi.mocked(videosApi.list).mockResolvedValue({
    content: [],
    page: { number: 0, size: 3, totalElements: 0, totalPages: 0, first: true, last: true },
  })
}

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
  vi.mocked(subscribeSse).mockResolvedValue(undefined)
  mockAll()
})

test('요약 묻기: 창이 열리고 요약 듣고 시작에 포커스, 바로 재생(Esc)으로 시작한다', async () => {
  const user = userEvent.setup()
  mockAll({ summaryMode: 'ASK' })
  const { container } = renderRoute('/watch/15')
  const dialog = await screen.findByRole('dialog', { name: '30초 요약을 먼저 들을까요?' })
  expect(
    within(dialog).getByText('요약을 들으면 무슨 내용인지 미리 알 수 있어요.'),
  ).toBeInTheDocument()
  expect(within(dialog).getByText('그래프 수업 요약이에요.')).toBeInTheDocument()
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: '요약 듣고 시작' })).toHaveFocus(),
  )
  await waitFor(() =>
    expect(band()).toHaveTextContent('30초 요약을 들을까요? Enter는 듣기, Esc는 바로 재생.'),
  )
  expect(screen.getByRole('heading', { level: 1, name: '그래프를 읽는 방법' })).toBeInTheDocument()
  expect(await axe(container)).toHaveNoViolations()

  // jsdom 은 Esc 로 cancel 이벤트를 내지 않으므로 같은 동작인 '바로 재생' 버튼을 누른다
  await user.click(within(dialog).getByRole('button', { name: '바로 재생' }))
  await waitFor(() => expect(dialog).not.toHaveAttribute('open'))
  expect(controls.play).toHaveBeenCalled()
  expect(say).not.toHaveBeenCalled()
  await waitFor(() => expect(band()).toHaveTextContent('바로 재생해요.'))
})

test('요약 듣고 시작: 요약을 읽은 뒤 재생한다', async () => {
  const user = userEvent.setup()
  mockAll({ summaryMode: 'ASK' })
  renderRoute('/watch/15')
  const dialog = await screen.findByRole('dialog', { name: '30초 요약을 먼저 들을까요?' })
  await waitFor(() => expect(band()).toHaveTextContent('30초 요약을 들을까요?'))
  await user.click(within(dialog).getByRole('button', { name: '요약 듣고 시작' }))
  // 요약을 듣는 동안 포커스는 재생 버튼 (창이 닫히며 본문으로 빠지지 않게)
  await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toHaveFocus())
  await waitFor(() =>
    expect(say).toHaveBeenCalledWith(expect.objectContaining({ text: '그래프 수업 요약이에요.' })),
  )
  await waitFor(() => expect(controls.play).toHaveBeenCalled())
  await waitFor(() => expect(band()).toHaveTextContent('요약이 끝났어요. 재생해요.'))
})

test('안 듣기: 재생 버튼에 포커스. 목차를 고르면 그 시각으로 옮기고 장면을 읽어 준다', async () => {
  const user = userEvent.setup()
  renderRoute('/watch/15')
  const play = await screen.findByRole('button', { name: '재생' })
  await waitFor(() => expect(play).toHaveFocus())
  await waitFor(() => expect(band()).toHaveTextContent('재생 버튼에 있어요. Space로 재생해요.'))
  expect(screen.getByRole('slider', { name: '재생 위치' })).toHaveAttribute(
    'aria-valuetext',
    '0초, 전체 4분 42초',
  )

  const toc = screen.getByRole('button', { name: /2번, 막대그래프 비교/ })
  await user.click(toc)
  expect(controls.seek).toHaveBeenCalledWith(T(48))
  await waitFor(() => expect(band()).toHaveTextContent('2. 막대그래프 비교 장면이에요. 48초.'))
  act(() => setPlayerState?.({ currentMs: T(48) }))
  expect(screen.getByRole('button', { name: /2번, 막대그래프 비교, 지금/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
})

test('재생 중 문장 시각을 지나면 읽고, 재생바로 건너뛴 문장은 읽지 않는다', async () => {
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  act(() => setPlayerState?.({ playing: true, currentMs: T(7.5) }))
  act(() => setPlayerState?.({ currentMs: T(8.2) }))
  await waitFor(() =>
    expect(say).toHaveBeenCalledWith(expect.objectContaining({ text: '칠판이 보여요.' })),
  )
  expect(screen.getByText('칠판이 보여요.')).toBeInTheDocument()
  say.mockClear()
  // 2:14 로 크게 건너뜀 → 그 시각 문장은 읽지 않고 화면에만 보인다
  act(() => setPlayerState?.({ currentMs: T(134.3) }))
  expect(say).not.toHaveBeenCalled()
  expect(screen.getAllByText('세 개의 막대가 있는 그래프예요.').length).toBeGreaterThan(0)
})

test('상세도는 누적이다: 기본은 1·2단계, 자세히를 고르면 3단계 문장이 더해지고 설정이 저장된다', async () => {
  const user = userEvent.setup()
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  await user.click(screen.getByRole('tab', { name: '대본' }))
  expect(await screen.findByText('해설 대본 · 2문장')).toBeInTheDocument()
  expect(screen.queryByText('가운데가 가장 높아요.')).not.toBeInTheDocument()

  await user.click(screen.getByRole('radio', { name: '3 자세한 해설' }))
  expect(usersApi.updateSettings).toHaveBeenCalledWith({ detailLevel: 3 })
  await waitFor(() => expect(band()).toHaveTextContent('해설 상세도 3 자세한 해설.'))
  expect(await screen.findByText('해설 대본 · 3문장')).toBeInTheDocument()
  const texts = screen
    .getAllByText(/칠판이 보여요|세 개의 막대가|가운데가 가장 높아요/)
    .map((el) => el.textContent)
  expect(texts).toEqual([
    '칠판이 보여요.',
    '세 개의 막대가 있는 그래프예요.',
    '가운데가 가장 높아요.',
  ])

  await user.click(screen.getByRole('radio', { name: '1 짧은 해설' }))
  expect(await screen.findByText('해설 대본 · 1문장')).toBeInTheDocument()
})

test('이 문장 신고: 지금 문장을 보여 주고 사유를 골라 보낸다. 여는 동안 영상을 멈춘다', async () => {
  const user = userEvent.setup()
  vi.mocked(reportsApi.create).mockResolvedValue({ reportId: 7, status: 'PENDING' })
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  act(() => setPlayerState?.({ playing: true, currentMs: T(135) }))
  await user.click(screen.getByRole('button', { name: '이 문장 신고' }))
  expect(controls.pause).toHaveBeenCalled()
  const dialog = await screen.findByRole('dialog', { name: '이 문장 신고' })
  expect(within(dialog).getByText('세 개의 막대가 있는 그래프예요.')).toBeInTheDocument()
  await waitFor(() =>
    expect(within(dialog).getByRole('radio', { name: '틀린 내용' })).toHaveFocus(),
  )
  await user.click(within(dialog).getByRole('radio', { name: '대사와 겹침' }))
  await user.click(within(dialog).getByRole('button', { name: '신고 보내기' }))
  await waitFor(() =>
    expect(reportsApi.create).toHaveBeenCalledWith(502, {
      reportedAtMs: T(135),
      reason: 'OVERLAP',
      reasonDetail: undefined,
    }),
  )
  await waitFor(() => expect(dialog).not.toHaveAttribute('open'))
  await waitFor(() => expect(band()).toHaveTextContent('신고했어요. 검토한 뒤 고칠게요.'))
  expect(controls.play).toHaveBeenCalled()
})

test('질문: 영상을 멈추고 답을 문장 단위로 읽은 뒤 끝났다고 알리고 입력칸으로 돌아온다', async () => {
  const user = userEvent.setup()
  vi.mocked(chatApi.send).mockResolvedValue({
    chatLogId: 88,
    inputMode: 'TEXT',
    utterance: '지금 화면에 숫자도 나와?',
    intent: 'QUESTION',
    result: { answerStreamUrl: '/api/v1/chat/messages/88/stream' },
  })
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  act(() => setPlayerState?.({ playing: true, currentMs: T(134) }))
  const input = screen.getByRole('textbox', { name: '질문하거나 명령하기' })
  await user.type(input, '지금 화면에 숫자도 나와?{Enter}')
  await waitFor(() =>
    expect(chatApi.send).toHaveBeenCalledWith({
      videoId: 15,
      descriptionId: 20,
      videoTimeMs: T(134),
      utterance: '지금 화면에 숫자도 나와?',
      inputMode: 'TEXT',
    }),
  )
  await waitFor(() =>
    expect(subscribeSse).toHaveBeenCalledWith('/chat/messages/88/stream', expect.anything()),
  )
  expect(controls.pause).toHaveBeenCalled()
  // 답을 받는 동안에도 포커스는 입력칸에 남는다 (disabled 면 본문으로 빠진다). 읽기 전용으로만 막는다
  expect(input).toHaveFocus()
  expect(input).toHaveAttribute('readonly')
  expect(screen.getByRole('tab', { name: '질문 기록' })).toHaveAttribute('aria-selected', 'true')

  act(() => sse().onMessage({ event: 'delta', data: JSON.stringify({ text: '네. 막대 위에 ' }) }))
  act(() =>
    sse().onMessage({
      event: 'sentence',
      data: JSON.stringify({
        text: '네. 막대 위에 12, 30, 21이 적혀 있어요.',
        audioUrl: 'https://s3/a.mp3',
      }),
    }),
  )
  act(() =>
    sse().onMessage({
      event: 'done',
      data: JSON.stringify({
        answerText: '네. 막대 위에 12, 30, 21이 적혀 있어요.',
        answerSource: 'STORED',
        firstAudioMs: 1,
        totalLatencyMs: 2,
      }),
    }),
  )
  act(() => sse().onClose('done'))

  await waitFor(() =>
    expect(say).toHaveBeenCalledWith(expect.objectContaining({ audioUrl: 'https://s3/a.mp3' })),
  )
  await waitFor(() =>
    expect(band()).toHaveTextContent('답변이 끝났어요. 네. 막대 위에 12, 30, 21이 적혀 있어요.'),
  )
  expect(controls.play).toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: '질문하거나 명령하기' })).toHaveFocus()
  expect(screen.getByText('질문 기록 · 2개')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /그 장면 보기, 2분 14초/ })).toBeInTheDocument()
})

test('장면 이동 후보가 여럿이면 번호를 읽어 주고, 고르면 그 시각으로 옮긴다', async () => {
  const user = userEvent.setup()
  vi.mocked(chatApi.send).mockResolvedValue({
    chatLogId: 89,
    inputMode: 'TEXT',
    utterance: 'B반 나오는 장면으로 가 줘',
    intent: 'SEEK_SCENE',
    result: {
      targetMs: null,
      chapterId: null,
      candidates: [
        {
          chapterId: 2,
          title: '막대그래프 비교',
          startMs: T(52),
          summary: 'B반 막대가 처음 나와요',
        },
        {
          chapterId: 2,
          title: '막대그래프 비교',
          startMs: T(141),
          summary: '선생님이 B 막대를 가리켜요',
        },
      ],
    },
  })
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  await user.type(
    screen.getByRole('textbox', { name: '질문하거나 명령하기' }),
    'B반 나오는 장면으로 가 줘{Enter}',
  )
  const group = await screen.findByRole('radiogroup', { name: '장면 후보' })
  await waitFor(() =>
    expect(band()).toHaveTextContent(
      '비슷한 장면이 2곳 있어요. 1번, 52초. 2번, 2분 21초. 번호를 고르세요.',
    ),
  )
  const first = within(group).getAllByRole('radio')[0]
  await waitFor(() => expect(first).toHaveFocus())
  await user.keyboard('{ArrowDown}{Enter}')
  expect(controls.seek).toHaveBeenCalledWith(T(141))
  await waitFor(() => expect(band()).toHaveTextContent('막대그래프 비교, 2분 21초으로 옮겼어요.'))
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
})

test('크게 보기: 패널을 숨기고 Esc 로 돌아온다', async () => {
  const user = userEvent.setup()
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  await user.click(screen.getByRole('button', { name: '크게 보기' }))
  // 크게 보기: 질문 입력칸과 질문 기록만 오른쪽에 남고, 목차·대본 탭과 즐겨찾기는 숨긴다
  expect(screen.getByRole('textbox', { name: '질문하거나 명령하기' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /질문 기록/ })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: '목차' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /즐겨찾기/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '작게 보기' })).toHaveFocus()
  expect(screen.queryByRole('button', { name: '이 문장 신고' })).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: '해설 상세도' })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(await screen.findByRole('tab', { name: '목차' })).toBeInTheDocument()
  await waitFor(() => expect(band()).toHaveTextContent('작게 보기로 돌아왔어요.'))
  expect(screen.getByRole('button', { name: '크게 보기' })).toHaveFocus()
})

test('전체 화면: 영상·해설·재생줄만 남기고, 끝내면 전체 화면 버튼으로 돌아온다', async () => {
  const user = userEvent.setup()
  let fsEl: Element | null = null
  const fire = () => document.dispatchEvent(new Event('fullscreenchange'))
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl })
  const request = vi.fn((el: Element) => {
    fsEl = el
    fire()
    return Promise.resolve()
  })
  HTMLElement.prototype.requestFullscreen = function () {
    return request(this)
  }
  document.exitFullscreen = vi.fn(() => {
    fsEl = null
    fire()
    return Promise.resolve()
  })
  try {
    mockAll()
    renderRoute('/watch/15')
    await screen.findByRole('button', { name: '재생' })
    // 진입 안내(요약·해설을 다 받은 뒤 한 프레임 늦게 나옴)가 끝난 뒤에 눌러야 한다.
    // 먼저 누르면 뒤늦게 온 진입 안내가 '전체 화면이에요.'를 덮어 써서 가끔 실패했다
    await waitFor(() => expect(band()).toHaveTextContent('재생 버튼에 있어요.'))
    await user.click(screen.getByRole('button', { name: '전체 화면' }))
    expect(await screen.findByRole('button', { name: '전체 화면 끝내기' })).toBeInTheDocument()
    expect(fsEl).toContainElement(screen.getByRole('slider', { name: '재생 위치' }))
    expect(screen.queryByRole('button', { name: '크게 보기' })).not.toBeInTheDocument()
    await waitFor(() => expect(band()).toHaveTextContent('전체 화면이에요.'))

    await user.click(screen.getByRole('button', { name: '전체 화면 끝내기' }))
    expect(await screen.findByRole('button', { name: '전체 화면' })).toHaveFocus()
    expect(screen.getByRole('button', { name: '크게 보기' })).toBeInTheDocument()
    await waitFor(() => expect(band()).toHaveTextContent('전체 화면을 끝냈어요.'))
  } finally {
    Reflect.deleteProperty(document, 'fullscreenEnabled')
    Reflect.deleteProperty(document, 'fullscreenElement')
  }
})

test('볼 수 없는 영상: 안내와 즐겨찾기에서 빼기', async () => {
  const user = userEvent.setup()
  mockAll({}, { status: 'UNAVAILABLE', isFavorite: true, descriptionId: null })
  vi.mocked(favoritesApi.remove).mockResolvedValue({ videoId: 15, isFavorite: false })
  const { router } = renderRoute('/watch/15')
  expect(await screen.findByText('더 이상 볼 수 없는 영상이에요')).toBeInTheDocument()
  await waitFor(() => expect(band()).toHaveTextContent('즐겨찾기에서 빼기 버튼에 있어요.'), {
    timeout: 3000,
  })
  await user.click(screen.getByRole('button', { name: /즐겨찾기에서 빼기/ }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
})

test('해설이 아직 없고 만드는 중이면 해설 만들기 화면으로 보낸다', async () => {
  mockAll({}, { descriptionId: null, activeJobId: 51 })
  const { router } = renderRoute('/watch/15')
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/51'))
})

/* ── 챗봇: 지금까지 줄거리·"들으시겠어요?"·새 명령·설정 범위 끝 ── */

/** 입력칸에 적어 보낸다 */
async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByRole('textbox', { name: '질문하거나 명령하기' }), `${text}{Enter}`)
}
/** 답변 스트림을 문장 하나로 끝낸다 */
function answer(text: string, futureAvailable = false) {
  act(() => sse().onMessage({ event: 'sentence', data: JSON.stringify({ text, audioUrl: null }) }))
  act(() =>
    sse().onMessage({
      event: 'done',
      data: JSON.stringify({
        answerText: text,
        answerSource: 'STORED',
        firstAudioMs: 1,
        totalLatencyMs: 2,
        futureAvailable,
      }),
    }),
  )
  act(() => sse().onClose('done'))
}

test('지금까지 줄거리(RECAP)는 질문처럼 답변을 받아 읽는다', async () => {
  const user = userEvent.setup()
  vi.mocked(chatApi.send).mockResolvedValue({
    chatLogId: 90,
    inputMode: 'TEXT',
    utterance: '지금까지 줄거리',
    intent: 'RECAP',
    result: { answerStreamUrl: '/api/v1/chat/messages/90/stream' },
  })
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  await ask(user, '지금까지 줄거리')
  await waitFor(() =>
    expect(subscribeSse).toHaveBeenCalledWith('/chat/messages/90/stream', expect.anything()),
  )
  // 답을 받는 동안에도 버튼 자리는 있고 누를 수 없다 (끝난 뒤 생겨서 화면이 밀리지 않게)
  const replay = await screen.findByRole('button', { name: /^다시 듣기, AudiSay 답/ })
  expect(replay).toHaveAttribute('aria-disabled', 'true')
  answer('막대그래프로 두 반을 비교했어요.')
  await waitFor(() =>
    expect(band()).toHaveTextContent('답변이 끝났어요. 막대그래프로 두 반을 비교했어요.'),
  )
  expect(replay).not.toHaveAttribute('aria-disabled')
  expect(band()).not.toHaveTextContent('알아듣지 못했어요')
})

test('"들으시겠어요?" 뒤에 네라고 하면 같은 질문을 뒤 내용까지 넣어 다시 받는다', async () => {
  const user = userEvent.setup()
  vi.mocked(chatApi.send).mockResolvedValue({
    chatLogId: 91,
    inputMode: 'TEXT',
    utterance: '범인이 누구야?',
    intent: 'QUESTION',
    result: { answerStreamUrl: '/api/v1/chat/messages/91/stream' },
  })
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  await ask(user, '범인이 누구야?')
  await waitFor(() => expect(subscribeSse).toHaveBeenCalledTimes(1))
  answer('지금까지는 나오지 않았어요. 뒤에 나오는데, 들으시겠어요?', true)
  await waitFor(() => expect(band()).toHaveTextContent("들으려면 '네', 아니면 '아니요'"))

  await ask(user, '네 들을게요')
  await waitFor(() =>
    expect(subscribeSse).toHaveBeenLastCalledWith(
      '/chat/messages/91/stream?includeFuture=true',
      expect.anything(),
    ),
  )
  expect(chatApi.send).toHaveBeenCalledTimes(1) // 새 질문으로 보내지 않는다
  answer('범인은 B반 선생님이에요.')
  await waitFor(() => expect(band()).toHaveTextContent('답변이 끝났어요. 범인은 B반 선생님이에요.'))
})

test('"들으시겠어요?" 뒤에 아니요라고 하면 다시 받지 않고, 다른 말이면 새 질문으로 보낸다', async () => {
  const user = userEvent.setup()
  vi.mocked(chatApi.send).mockResolvedValue({
    chatLogId: 92,
    inputMode: 'TEXT',
    utterance: '범인이 누구야?',
    intent: 'QUESTION',
    result: { answerStreamUrl: '/api/v1/chat/messages/92/stream' },
  })
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  await ask(user, '범인이 누구야?')
  await waitFor(() => expect(subscribeSse).toHaveBeenCalledTimes(1))
  answer('뒤에 나오는데, 들으시겠어요?', true)
  await waitFor(() => expect(band()).toHaveTextContent("'아니요'"))

  await ask(user, '아니요')
  await waitFor(() => expect(band()).toHaveTextContent('알겠어요.'))
  expect(chatApi.send).toHaveBeenCalledTimes(1)
  expect(subscribeSse).toHaveBeenCalledTimes(1)

  // 한 번 답했으면 그 뒤의 '네'는 새 질문이다
  await ask(user, '네')
  await waitFor(() => expect(chatApi.send).toHaveBeenCalledTimes(2))
})

test('새 명령: 방금 거 다시 듣기 / 이동 되돌리기 / 읽기 멈추기', async () => {
  const user = userEvent.setup()
  const action = (chatLogId: number, actionCode: string) => ({
    chatLogId,
    inputMode: 'TEXT' as const,
    utterance: actionCode,
    intent: 'ACTION' as const,
    result: { actionCode: actionCode as never },
  })
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })

  // 이동한 적이 없으면 되돌릴 게 없다고 알린다
  vi.mocked(chatApi.send).mockResolvedValueOnce(action(93, 'UNDO_SEEK'))
  await ask(user, '되돌려')
  await waitFor(() => expect(band()).toHaveTextContent('되돌릴 이동이 없어요.'))

  // 목차로 2분 30초에 갔다가 되돌리면 이동 전(0초)으로
  act(() => setPlayerState?.({ currentMs: T(20) }))
  await user.click(
    screen.getByRole('button', { name: /3번, 선그래프로 보기|2번, 막대그래프 비교/ }),
  )
  vi.mocked(chatApi.send).mockResolvedValueOnce(action(94, 'UNDO_SEEK'))
  await ask(user, '아까 거기로 돌아가')
  await waitFor(() => expect(controls.seek).toHaveBeenLastCalledWith(T(20)))
  await waitFor(() => expect(band()).toHaveTextContent('이동하기 전 위치, 20초로 돌아왔어요.'))

  // 방금 읽은 소리를 다시
  say.mockClear()
  lastSaid = { text: '세 개의 막대가 있는 그래프예요.' }
  vi.mocked(chatApi.send).mockResolvedValueOnce(action(95, 'REPEAT_LAST'))
  await ask(user, '방금 거 다시')
  await waitFor(() =>
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({ text: '세 개의 막대가 있는 그래프예요.' }),
    ),
  )

  // 읽기만 멈춘다
  stopNarrator.mockClear()
  vi.mocked(chatApi.send).mockResolvedValueOnce(action(96, 'STOP_SPEAKING'))
  await ask(user, '그만 읽어')
  await waitFor(() => expect(band()).toHaveTextContent('읽던 소리를 멈췄어요.'))
  expect(stopNarrator).toHaveBeenCalled()

  // 이 화면에서 못 하는 기능은 '실행했어요'라고 남기지 않는다
  vi.mocked(chatApi.send).mockResolvedValueOnce(action(97, 'SOMETHING_NEW'))
  await ask(user, '새 기능')
  await waitFor(() => expect(band()).toHaveTextContent('이 화면에서는 할 수 없는 기능이에요.'))
  await user.click(screen.getByRole('tab', { name: '질문 기록' }))
  expect(
    await screen.findByText('"SOMETHING_NEW" → 이 화면에서는 할 수 없는 기능이에요'),
  ).toBeInTheDocument()
  expect(screen.queryByText('"SOMETHING_NEW" → 실행했어요')).not.toBeInTheDocument()
})

test('설정이 범위 끝이면 서버가 준 말을 읽고, 아니면 바꾼 설정을 말로 알린다', async () => {
  const user = userEvent.setup()
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })

  vi.mocked(chatApi.send).mockResolvedValueOnce({
    chatLogId: 98,
    inputMode: 'TEXT',
    utterance: '더 빠르게',
    intent: 'SETTING',
    result: { settingKey: 'speechRate', settingValue: '2.5', message: '이미 가장 빠른 속도예요.' },
  })
  await ask(user, '더 빠르게')
  await waitFor(() => expect(band()).toHaveTextContent('이미 가장 빠른 속도예요.'))
  expect(band()).not.toHaveTextContent('설정을 바꿨어요')

  vi.mocked(chatApi.send).mockResolvedValueOnce({
    chatLogId: 99,
    inputMode: 'TEXT',
    utterance: '조금 느리게',
    intent: 'SETTING',
    result: { settingKey: 'speechRate', settingValue: '0.8', message: null },
  })
  await ask(user, '조금 느리게')
  await waitFor(() => expect(band()).toHaveTextContent('말하기 속도 0.8배로 바꿨어요.'))
})

test('영상 안에서 다른 영상을 찾으라고 하면 서버 안내를 읽고 화면을 옮기지 않는다', async () => {
  const user = userEvent.setup()
  mockAll()
  vi.mocked(chatApi.send).mockResolvedValue({
    chatLogId: 95,
    inputMode: 'TEXT',
    utterance: '고양이 영상 찾아 줘',
    intent: 'SEARCH_VIDEO',
    result: { query: null, message: '다른 영상은 검색 화면에서 찾아 주세요.' },
  })
  const { router } = renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  await ask(user, '고양이 영상 찾아 줘')
  await waitFor(() => expect(band()).toHaveTextContent('다른 영상은 검색 화면에서 찾아 주세요.'))
  expect(router.state.location.pathname).toBe('/watch/15')
})

test('장면을 못 찾으면 서버가 준 이유를 읽고 기록에 남긴다', async () => {
  const user = userEvent.setup()
  vi.mocked(chatApi.send).mockResolvedValue({
    chatLogId: 100,
    inputMode: 'TEXT',
    utterance: '골 넣는 장면',
    intent: 'SEEK_SCENE',
    result: {
      targetMs: null,
      chapterId: null,
      candidates: [],
      message: '지금은 장면을 찾는 데 시간이 오래 걸려요. 잠시 뒤 다시 말씀해 주세요.',
    },
  })
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  await ask(user, '골 넣는 장면')
  await waitFor(() => expect(band()).toHaveTextContent('시간이 오래 걸려요'))
  expect(band()).not.toHaveTextContent('찾지 못했어요')
  await user.click(screen.getByRole('tab', { name: '질문 기록' }))
  expect(await screen.findByText(/"골 넣는 장면" → 지금은 장면을 찾는 데/)).toBeInTheDocument()
})

test('재생 중 "요약 들려줘"는 뒤 내용이 있다고 먼저 묻고, 네라고 하면 들려준다', async () => {
  const user = userEvent.setup()
  const summary = (chatLogId: number) => ({
    chatLogId,
    inputMode: 'TEXT' as const,
    utterance: '요약 들려줘',
    intent: 'ACTION' as const,
    result: { actionCode: 'PLAY_SUMMARY' as const },
  })
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  act(() => setPlayerState?.({ currentMs: T(40) }))

  vi.mocked(chatApi.send).mockResolvedValueOnce(summary(101))
  await ask(user, '요약 들려줘')
  await waitFor(() => expect(band()).toHaveTextContent('요약에는 뒤 내용이 있어요. 들으시겠어요?'))
  expect(say).not.toHaveBeenCalledWith(expect.objectContaining({ text: '그래프 수업 요약이에요.' }))

  // 아니요면 듣지 않는다
  await ask(user, '아니요')
  await waitFor(() => expect(band()).toHaveTextContent('알겠어요.'))
  expect(say).not.toHaveBeenCalledWith(expect.objectContaining({ text: '그래프 수업 요약이에요.' }))

  // 다시 청하고 네라고 하면 들려준다 (새 질문으로 보내지 않음)
  vi.mocked(chatApi.send).mockResolvedValueOnce(summary(102))
  await ask(user, '요약 들려줘')
  await waitFor(() => expect(band()).toHaveTextContent('들으시겠어요?'))
  await ask(user, '네')
  await waitFor(() =>
    expect(say).toHaveBeenCalledWith(expect.objectContaining({ text: '그래프 수업 요약이에요.' })),
  )
  expect(chatApi.send).toHaveBeenCalledTimes(2)
})

test('재생 전(0초) "요약 들려줘"는 묻지 않고 바로 들려준다', async () => {
  const user = userEvent.setup()
  vi.mocked(chatApi.send).mockResolvedValue({
    chatLogId: 103,
    inputMode: 'TEXT',
    utterance: '요약 들려줘',
    intent: 'ACTION',
    result: { actionCode: 'PLAY_SUMMARY' },
  })
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  await ask(user, '요약 들려줘')
  await waitFor(() =>
    expect(say).toHaveBeenCalledWith(expect.objectContaining({ text: '그래프 수업 요약이에요.' })),
  )
  expect(band()).not.toHaveTextContent('들으시겠어요?')
})

test('질문 기록에서 답을 끝까지 받지 못한 질문은 받은 데까지와 안내를 보여 준다', async () => {
  const user = userEvent.setup()
  vi.mocked(videosApi.chatHistory).mockResolvedValue({
    messages: [
      {
        chatLogId: 2,
        inputMode: 'TEXT',
        utterance: '두 번째 질문',
        intent: 'QUESTION',
        videoTimeMs: T(10),
        targetMs: null,
        answerText: null,
        answerSource: null,
        createdAt: '2026-11-05T00:01:00Z',
      },
      {
        chatLogId: 1,
        inputMode: 'TEXT',
        utterance: '첫 질문',
        intent: 'QUESTION',
        videoTimeMs: T(5),
        targetMs: null,
        answerText: 'B반이',
        answerSource: null,
        createdAt: '2026-11-05T00:00:00Z',
      },
    ],
    nextCursor: null,
    hasNext: false,
  })
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  await user.click(screen.getByRole('tab', { name: '질문 기록' }))
  expect(await screen.findByText('B반이 (답을 다 받지 못했어요)')).toBeInTheDocument()
  expect(screen.getByText('(답을 다 받지 못했어요)')).toBeInTheDocument()
})

const keys = (k: string) => `{Alt>}{Shift>}${k}{/Shift}{/Alt}`

test('시청 화면 단축키: K 재생·멈춤, J/L 이동, P 위치, 1~3 상세도, S 설정, X 신고. 창이 열려 있으면 뒤 화면은 움직이지 않는다', async () => {
  const user = userEvent.setup()
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })

  await user.keyboard(keys('K'))
  expect(controls.play).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(band()).toHaveTextContent('재생해요.'))
  act(() => setPlayerState?.({ playing: true, currentMs: T(30) }))
  await user.keyboard(keys('K'))
  expect(controls.pause).toHaveBeenCalled()
  act(() => setPlayerState?.({ playing: false }))

  // 기본 이동 간격 10초
  await user.keyboard(keys('L'))
  expect(controls.seek).toHaveBeenLastCalledWith(T(40))
  act(() => setPlayerState?.({ currentMs: T(40) }))
  await user.keyboard(keys('J'))
  expect(controls.seek).toHaveBeenLastCalledWith(T(30))
  act(() => setPlayerState?.({ currentMs: T(5) }))
  await user.keyboard(keys('J'))
  expect(controls.seek).toHaveBeenLastCalledWith(0)

  act(() => setPlayerState?.({ currentMs: T(48) }))
  await user.keyboard(keys('P'))
  await waitFor(() => expect(band()).toHaveTextContent('48초.'))

  await user.keyboard(keys('3'))
  await waitFor(() =>
    expect(usersApi.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ detailLevel: 3 }),
    ),
  )
  await waitFor(() => expect(band()).toHaveTextContent('해설 상세도 3 자세한 해설.'))

  // 한 글자 1/2/3 은 더 이상 상세도를 바꾸지 않는다 (낭독기 제목 이동 키와 겹침)
  vi.mocked(usersApi.updateSettings).mockClear()
  screen.getByRole('button', { name: /^(재생|일시정지)$/ }).focus()
  await user.keyboard('1')
  expect(usersApi.updateSettings).not.toHaveBeenCalled()

  await user.keyboard(keys('S'))
  const settings = await screen.findByRole('dialog', { name: '재생 설정' })
  vi.mocked(controls.play).mockClear()
  await user.keyboard(keys('K'))
  expect(controls.play).not.toHaveBeenCalled()
  expect(controls.pause).toHaveBeenCalledTimes(1)
  await user.click(within(settings).getByRole('button', { name: '닫기' }))
  await waitFor(() => expect(settings).not.toHaveAttribute('open'))

  await user.keyboard(keys('X'))
  expect(await screen.findByRole('dialog', { name: '이 문장 신고' })).toBeInTheDocument()
})

test('재생 설정: 재생 중이면 열 때 멈추고 닫으면 이어서 재생, 멈춰 있었으면 그대로 둔다', async () => {
  const user = userEvent.setup()
  renderRoute('/watch/15')
  const open = await screen.findByRole('button', { name: '재생 설정' })
  // 화면 진입 안내가 끝난 뒤에 조작한다 (진입 안내가 늦게 오면 띠 문구를 덮어쓴다)
  await waitFor(() => expect(band()).toHaveTextContent('영상 보기예요.'))

  // 재생 중 → 열면 멈춤, 닫으면 이어서 재생
  act(() => setPlayerState?.({ playing: true, currentMs: T(30) }))
  vi.mocked(controls.pause).mockClear()
  vi.mocked(controls.play).mockClear()
  await user.click(open)
  const dialog = await screen.findByRole('dialog', { name: '재생 설정' })
  expect(controls.pause).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(band()).toHaveTextContent('영상을 멈췄어요.'))
  // 창이 열린 동안 안내 영역은 창 안에 있어야 낭독기가 읽는다 (바깥은 inert)
  await waitFor(() =>
    expect(dialog.querySelector('[aria-live="polite"]')).toHaveTextContent('영상을 멈췄어요.'),
  )
  act(() => setPlayerState?.({ playing: false }))
  await user.click(within(dialog).getByRole('button', { name: '닫기' }))
  await waitFor(() => expect(dialog).not.toHaveAttribute('open'))
  expect(controls.play).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(band()).toHaveTextContent('이어서 재생해요.'))
  expect(dialog.querySelector('[aria-live]')).toBeNull()

  // 멈춰 있음 → 열고 닫아도 그대로
  vi.mocked(controls.pause).mockClear()
  vi.mocked(controls.play).mockClear()
  await user.click(screen.getByRole('button', { name: '재생 설정' }))
  await screen.findByRole('dialog', { name: '재생 설정' })
  await user.click(within(dialog).getByRole('button', { name: '닫기' }))
  await waitFor(() => expect(dialog).not.toHaveAttribute('open'))
  expect(controls.pause).not.toHaveBeenCalled()
  expect(controls.play).not.toHaveBeenCalled()
})

test('Alt+Shift+/ 안내 창은 시청 화면에서 쓰는 키 8줄과 어디서나 3줄을 보여 준다', async () => {
  const user = userEvent.setup()
  renderRoute('/watch/15')
  await screen.findByRole('button', { name: '재생' })
  await user.keyboard(keys('/'))
  const dialog = await screen.findByRole('dialog', { name: '단축키 안내' })
  const desc = (name: string) =>
    within(within(dialog).getByRole('list', { name }))
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.shortcut-dialog-desc')?.textContent)
  expect(desc('이 화면에서')).toEqual([
    '재생 / 일시정지',
    '뒤로 / 앞으로 이동',
    '지금 재생 위치 듣기',
    '지금 장면 설명 듣기',
    '해설 짧게 / 기본 / 자세히',
    '질문하기',
    '재생 설정 열기',
    '지금 해설 문장 신고',
  ])
  expect(desc('어디서나')).toEqual([
    '홈으로 가기',
    '방금 안내 다시 듣기',
    '지금 화면의 단축키 보기',
  ])
  expect(dialog).toHaveAccessibleDescription(/단축키 11개예요/)
})
