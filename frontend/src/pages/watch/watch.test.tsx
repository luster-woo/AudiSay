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
const say = vi.fn(async () => true)
const stopNarrator = vi.fn()
vi.mock('@/features/player/Narrator', () => ({
  Narrator: class {
    busy = false
    say = say
    stop = stopNarrator
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
  chatApi: { send: vi.fn(), streamPath: (id: number) => `/chat/messages/${id}/stream` },
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
    recommendSummary: true,
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
    within(dialog).getByText('이 영상은 대사가 많아 요약을 먼저 듣는 걸 권해요.'),
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
  await user.click(within(dialog).getByRole('button', { name: '요약 듣고 시작' }))
  await waitFor(() =>
    expect(say).toHaveBeenCalledWith(expect.objectContaining({ text: '그래프 수업 요약이에요.' })),
  )
  await waitFor(() => expect(controls.play).toHaveBeenCalled())
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

  await user.click(screen.getByRole('radio', { name: '3 자세히' }))
  expect(usersApi.updateSettings).toHaveBeenCalledWith({ detailLevel: 3 })
  await waitFor(() => expect(band()).toHaveTextContent('해설 상세도 3 자세히.'))
  expect(await screen.findByText('해설 대본 · 3문장')).toBeInTheDocument()
  const texts = screen
    .getAllByText(/칠판이 보여요|세 개의 막대가|가운데가 가장 높아요/)
    .map((el) => el.textContent)
  expect(texts).toEqual([
    '칠판이 보여요.',
    '세 개의 막대가 있는 그래프예요.',
    '가운데가 가장 높아요.',
  ])

  await user.click(screen.getByRole('radio', { name: '1 짧게' }))
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
  const input = screen.getByRole('textbox', { name: '질문이나 명령' })
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
  expect(screen.getByRole('textbox', { name: '질문이나 명령' })).toHaveFocus()
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
    screen.getByRole('textbox', { name: '질문이나 명령' }),
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
  expect(screen.queryByRole('textbox', { name: '질문이나 명령' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '작게 보기' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(await screen.findByRole('textbox', { name: '질문이나 명령' })).toBeInTheDocument()
  await waitFor(() => expect(band()).toHaveTextContent('작게 보기로 돌아왔어요.'))
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
