import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { afterScreenChangeMs } from '@/features/search/speechLead'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { favoritesApi } from '@/api/favorites'
import { queryKeys } from '@/api/queryKeys'
import { videosApi } from '@/api/videos'
import { ApiError, toUserMessage } from '@/api/errors'
import type { ChatActionCode, NarrationLine, UserSettings, VideoDetail } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ChoiceGroup } from '@/components/ui/ChoiceGroup'
import { cn } from '@/components/ui/cn'
import { Tabs } from '@/components/ui/Tabs'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { Narrator } from '@/features/player/Narrator'
import { SeekBar } from '@/features/player/SeekBar'
import { sceneAtMs, useNarration } from '@/features/player/useNarration'
import { usePlayerSource } from '@/features/player/usePlayerSource'
import { useSettings } from '@/features/settings/context'
import { DETAIL_LABELS } from '@/features/settings/labels'
import { useShortcutEntry, useShortcuts } from '@/features/shortcuts/context'
import { withRo } from '@/utils/korean'
import { formatDurationSpoken, formatPositionSpoken } from '@/utils/time'
import { AskPanel } from './AskPanel'
import { NarrationBox } from './NarrationBox'
import { ReportDialog } from './ReportDialog'
import { SettingsDialog } from './SettingsDialog'
import { SummaryDialog } from './SummaryDialog'
import type { HistoryEntry } from './history'
import { CandidatesPanel, ChaptersPanel, HistoryPanel, ScriptPanel } from './panels'
import { useAsk } from './useAsk'
import { VideoStage } from './VideoStage'

/** 상세도 버튼 이름: 재생 설정 창·챗봇 답과 같다 ('짧은 해설'). 단축키 Alt+Shift+1~3 은 aria-keyshortcuts 로 알린다 */
const DETAIL_OPTIONS = DETAIL_LABELS.map((o) => ({ ...o, keyShortcut: `Alt+Shift+${o.value}` }))
type Tab = 'chapters' | 'script'
/** 영상을 열고 요약을 어떻게 할지 정하는 단계 */
type SummaryPhase = 'loading' | 'asking' | 'playing' | 'done'
type SummaryMode = UserSettings['summaryMode']
/** 기능 실행 결과: 실제로 한 일을 말하는 문장과, 장면 이동이면 옮긴 시각 */
export interface ActionResult {
  said: string
  goToMs: number | null
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)

/** 재생·해설 상세도·신고·설정·크게 보기: 같은 높이·폭·글자 크기 (글자가 바뀌어도 폭이 그대로) */
const CONTROL = 'w-[6.75rem] px-2! text-xl whitespace-nowrap'
/** 즐겨찾기·신고·재생 설정: 영상 조작보다 가볍게 (연한 테두리, 조금 낮게). 마우스를 올리면 진한 테두리 */
const SUB_CONTROL = 'min-h-12! border-line! px-2! text-xl whitespace-nowrap hover:border-navy!'
/** '전체 화면 끝내기'는 글자가 길어 조금 넓게 */
const CONTROL_WIDE = 'w-[9.5rem] px-2! text-xl whitespace-nowrap'

/**
 * 시청 화면 본체. 영상 정보(해설 있음)를 받아 재생 주소·해설·목차·요약을 불러오고,
 * 플레이어 + 질문 패널을 그린다. 읽는 순서: 제목 → 플레이어 컨트롤 → 상세도 → 신고·설정·크게 보기 → 질문 → 패널 탭 (원칙 3장)
 */

/** 화면에 들어올 때의 질문 기록: 늘 비어 있다 (매 렌더 같은 배열이라 useAsk 가 새로 그리지 않는다) */
const NO_HISTORY: HistoryEntry[] = []

export function Player({ video }: { video: VideoDetail }) {
  const videoId = video.videoId
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { settings, update, isLoaded: settingsLoaded } = useSettings()
  const { announce, bindVoice } = useAnnouncer()
  const { setHelpOpen } = useShortcuts()
  const [narrator] = useState(() => new Narrator())
  useEffect(() => () => narrator.stop(), [narrator])
  // 낭독기 안내와 우리 음성이 겹치지 않게 순서를 맞춘다
  useEffect(() => bindVoice(narrator), [bindVoice, narrator])

  /* ── 데이터 ── */
  const playbackQ = useQuery({
    queryKey: queryKeys.playback(videoId),
    queryFn: () => videosApi.playback(videoId),
    staleTime: 50 * 60 * 1000, // 주소는 1시간 유효
    refetchInterval: 50 * 60 * 1000,
  })
  const descriptionQ = useQuery({
    queryKey: queryKeys.description(videoId),
    queryFn: () => videosApi.description(videoId),
    staleTime: 5 * 60 * 60 * 1000, // 음성 주소는 6시간 유효. 만료되면 refreshAudioUrl 이 다시 받는다
  })
  const chaptersQ = useQuery({
    queryKey: queryKeys.chapters(videoId),
    queryFn: () => videosApi.chapters(videoId),
    staleTime: Infinity,
  })
  const summaryQ = useQuery({
    queryKey: queryKeys.summary(videoId),
    queryFn: () => videosApi.summary(videoId),
    staleTime: 5 * 60 * 60 * 1000,
    retry: false,
  })
  const description = descriptionQ.data
  const chapters = chaptersQ.data?.chapters ?? []
  const summary = summaryQ.data

  /* ── 재생 소스 + 해설 읽기 ── */
  const { videoRef, ytHostRef, state, controls } = usePlayerSource(
    playbackQ.data,
    video.durationSec,
  )
  useEffect(() => {
    if (state.ready) controls.setVolume(settings.originalVolume)
  }, [state.ready, settings.originalVolume, controls])

  const refreshAudioUrl = useCallback(
    async (lineId: number) => {
      const fresh = await queryClient.fetchQuery({
        queryKey: queryKeys.description(videoId),
        queryFn: () => videosApi.description(videoId),
        staleTime: 0,
      })
      return fresh.lines.find((l) => l.lineId === lineId)?.audioUrl ?? null
    },
    [queryClient, videoId],
  )
  const narration = useNarration({
    description,
    state,
    controls,
    settings,
    narrator,
    refreshAudioUrl,
    announce,
  })
  const {
    holdWhile,
    interrupt: stopNarration,
    holding,
    currentLine,
    currentScriptLine,
    lines,
    markSeek,
    readLine,
    dubIds,
  } = narration
  // 사용자 입장의 '재생 중': 해설·답을 읽느라 잠깐 멈춰 둔 상태도 재생 중으로 본다
  const playingNow = state.playing || holding

  // 답을 듣는 중(useAsk)이면 그 답 스트림도 함께 끊는다. useAsk 는 아래에서 만들어지므로 ref 로 잇는다
  const stopAnswerRef = useRef<(opts?: { quiet?: boolean }) => boolean>(() => false)
  /**
   * 사용자가 직접 재생·멈춤·이동하거나 창을 열 때: 읽던 해설·답 소리와 걸어 둔 멈춤을 거두고,
   * 받는 중인 답 스트림도 끊는다(남은 문장이 영상 소리 위로 이어서 읽히지 않게, 원칙 1장)
   */
  const interrupt = useCallback(
    (resume = true) => {
      stopAnswerRef.current({ quiet: true })
      return stopNarration(resume)
    },
    [stopNarration],
  )

  /* ── 화면 상태 ── */
  const [startedFlag, setStarted] = useState(false)
  const [enlarged, setEnlarged] = useState(false)
  const [tab, setTab] = useState<Tab>('chapters')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [report, setReport] = useState<{ line: NarrationLine | null; ms: number } | null>(null)
  const [decided, setDecided] = useState<'playing' | 'done' | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const playRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const resumeAfterVoice = useRef<boolean | null>(null)

  // 재생을 한 번이라도 했으면(또는 시각이 움직였으면) '해설' 상자에 문장을 보인다
  const started = startedFlag || state.playing || state.currentMs > 0
  const scene = sceneAtMs(description?.scenes, state.currentMs)

  /* ── 재생 조작 ── */
  const toggle = useCallback(() => {
    if (playingNow) {
      // 해설 때문에 잠깐 멈춰 둔 상태여도 '멈춤'이다: 읽던 소리를 거두고 멈춘 채로 둔다
      interrupt(false)
      controls.pause()
      announce('멈췄어요.')
      return
    }
    if (state.error) {
      announce(state.error, { politeness: 'assertive' })
      return
    }
    if (!state.ready) {
      announce('영상을 불러오는 중이에요. 잠시 뒤에 다시 눌러 주세요.')
      return
    }
    interrupt(false)
    setStarted(true)
    controls.play()
    announce('재생해요.')
  }, [playingNow, state.error, state.ready, interrupt, controls, announce])

  // 이동하기 전 위치 ('되돌려 줘' 명령용). 재생바를 연달아 누르는 동안에는 처음 위치만 남긴다
  const beforeSeekRef = useRef<number | null>(null)
  const seekBurstRef = useRef(false)
  const seekTo = useCallback(
    (ms: number, said?: string) => {
      beforeSeekRef.current = state.currentMs
      interrupt()
      controls.seek(ms)
      // 다음 tick 이 큰 이동으로 보고 소리를 끊지 않게, 옮긴 자리부터 세게 한다 (옮긴 지점의 문장도 읽는다)
      markSeek(ms)
      const at = sceneAtMs(description?.scenes, ms)
      announce(
        said ?? `${withRo(formatPositionSpoken(ms))} 옮겼어요.${at ? ` ${at.title} 장면.` : ''}`,
      )
    },
    [state.currentMs, interrupt, controls, markSeek, description, announce],
  )

  const setDetail = useCallback(
    (level: 1 | 2 | 3) => {
      void update({ detailLevel: level })
      announce(`해설 상세도 ${DETAIL_OPTIONS.find((o) => o.value === level)?.label}.`)
    },
    [update, announce],
  )

  /*
   * 낭독기가 화면 변화(창 닫힘·포커스 이동)와 안내를 다 읽을 때까지 기다린다 (원칙 1장: 소리는 한 번에 하나).
   * 웹 페이지는 낭독기가 언제 다 읽었는지 알 수 없어 글자 수로 어림한다. 기다리는 중 Esc 면 바로 끝난다
   */
  const waitDoneRef = useRef<(() => void) | null>(null)
  const waitForReader = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(id)
          waitDoneRef.current = null
          resolve()
        }
        const id = window.setTimeout(done, afterScreenChangeMs(text))
        waitDoneRef.current = done
      }),
    [],
  )
  useEffect(() => () => waitDoneRef.current?.(), [])

  /* ── 30초 요약 (NAV-06) ── */
  // 요약을 들려줄 때마다 올라가는 번호. 멈추거나 처음부터 다시 들으면 올라가서, 이전 요약의 남은 단계를 건너뛴다
  const summaryGenRef = useRef(0)
  /**
   * 요약을 들려준다.
   * - 'done': 끝까지 들었다
   * - 'stopped': 건너뛰기·다시 듣기로 멈췄다 (그쪽에서 처리한다)
   * - 'cut': 다른 소리·조작(음성 질문, 재생바 이동, 급한 안내)에 끊겼다. '요약이 끝났어요'라고 하지 않는다
   * said 가 없으면(요약 창에서 Enter·버튼으로 직접 고름) 안내 없이 바로 요약 소리를 낸다:
   * 안내를 낭독기가 다 읽을 때까지 3초쯤 기다리면 Enter 가 안 먹은 것처럼 느껴지고, 그사이 다시 누르면 처음부터 또 기다린다.
   * resume:false 면 다 듣고 이어서 재생하지 않는다 (챗봇 명령으로 들을 때)
   */
  const playSummary = useCallback(
    async (
      said: string | null,
      { resume = true }: { resume?: boolean } = {},
    ): Promise<'done' | 'stopped' | 'cut'> => {
      if (!summary) {
        announce('이 영상은 요약이 없어요.')
        return 'stopped'
      }
      const gen = ++summaryGenRef.current
      if (said) announce(said)
      let played = false
      const say = async () => {
        // 안내를 다 들은 뒤에 요약 소리를 낸다. 기다리는 중 멈췄으면 요약은 내지 않는다
        if (said) await waitForReader(said)
        if (summaryGenRef.current !== gen) return
        played = await narrator.say({
          text: summary.summary.text,
          audioUrl: summary.summary.audioUrl,
          rate: settings.speechRate,
          refreshUrl: async () => (await summaryQ.refetch()).data?.summary.audioUrl ?? null,
        })
      }
      if (started) await holdWhile(say, { resume })
      else await say()
      if (summaryGenRef.current !== gen) return 'stopped'
      return played ? 'done' : 'cut'
    },
    [summary, narrator, settings.speechRate, summaryQ, started, holdWhile, announce, waitForReader],
  )
  /** 듣는 중인 요약을 멈춘다 (기다림·소리 모두) */
  const stopSummary = useCallback(() => {
    summaryGenRef.current += 1
    waitDoneRef.current?.()
    narrator.stop()
  }, [narrator])

  /*
   * 요약 창은 요약을 듣는 동안에는 그대로 두고(화면이 바뀌면 낭독기가 다시 읽어 소리가 겹친다), 다 들으면 닫는다.
   * 듣는 중에는 '건너뛰기'(Esc)로 닫고, 닫히면 재생하지 않고 재생 버튼에서 기다린다 (원칙 1장: 자동 재생 없음).
   * 창이 닫히는 즉시 재생 버튼으로 포커스를 옮긴다(focusAfterCloseRef)
   */
  const [summaryInDialog, setSummaryInDialog] = useState(false)
  const waitAtPlay = useCallback(
    (text: string) => {
      setDecided('done')
      setSummaryInDialog(false)
      announce(text)
      // 창 없이 들은 경우(요약 '항상')에는 여기서 재생 버튼으로 옮긴다. 창이면 창이 닫히며 옮긴다
      // 브라우저 기본 스크롤은 화면을 크게 끌어올리므로, 버튼이 가려질 때만 최소한으로 스크롤한다
      requestAnimationFrame(() => {
        const el = playRef.current
        if (!el) return
        if (document.activeElement !== el) el.focus({ preventScroll: true })
        const r = el.getBoundingClientRect()
        if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'nearest' })
      })
    },
    [announce],
  )

  // 요약을 받은 뒤 설정(묻기 / 항상 / 안 듣기)대로 시작 단계가 정해진다. 사용자가 고르면 decided 가 앞선다
  const summarySettled = summaryQ.isSuccess || summaryQ.isError
  /*
   * 시작 단계는 화면에 들어올 때의 설정으로 한 번만 정한다. 보는 도중 재생 설정 창이나 챗봇('요약 항상 들려줘')으로
   * 요약 설정을 바꿔도 요약 창이 뜨거나, 요약이 저절로 읽히거나, 진입 안내가 다시 나오지 않게 한다
   */
  // 내 설정을 받기 전(기본값 '묻기')에 정해 버리지 않게, 설정을 받은 뒤에 정한다
  const [startMode, setStartMode] = useState<SummaryMode | null>(null)
  if (summarySettled && settingsLoaded && startMode === null)
    setStartMode(summaryQ.isSuccess ? settings.summaryMode : 'NEVER')
  const summaryMode = startMode ?? 'NEVER'
  const phase: SummaryPhase =
    !summarySettled || startMode === null
      ? 'loading'
      : (decided ??
        (summaryMode === 'ASK' ? 'asking' : summaryMode === 'ALWAYS' ? 'playing' : 'done'))
  const autoSummaryRef = useRef(false)
  useEffect(() => {
    if (phase !== 'playing' || decided !== null || autoSummaryRef.current) return
    autoSummaryRef.current = true
    void playSummary('30초 요약을 먼저 들려 드려요. Esc를 누르면 건너뛰어요.').then((end) => {
      if (end === 'cut') {
        // 다른 소리·조작에 끊겼다: 끝났다고 하지 않고, 포커스도 옮기지 않는다 (음성 질문을 녹음하는 중일 수 있다)
        setDecided('done')
        return
      }
      waitAtPlay(
        end === 'done' ? '요약이 끝났어요. Space를 누르면 재생해요.' : 'Space를 누르면 재생해요.',
      )
    })
  }, [phase, decided, playSummary, waitAtPlay])

  // 요약 듣고 시작: 창과 버튼은 그대로. 듣는 중에 다시 누르면 처음부터 다시 들려준다
  const onListenSummary = () => {
    if (phase === 'playing') stopSummary()
    setDecided('playing')
    setSummaryInDialog(true)
    void playSummary(null).then((end) => {
      if (end === 'stopped') return // 건너뛰기·다시 듣기로 멈췄으면 그쪽에서 처리한다
      if (end === 'cut') {
        // 다른 소리에 끊겼으면 '끝났어요'라고 하지 않고 포커스도 옮기지 않는다
        setDecided('done')
        return
      }
      // 다 들었으면 창을 닫고 재생 버튼에서 기다린다 (재생은 하지 않는다)
      waitAtPlay('요약이 끝났어요. Space를 누르면 재생해요.')
    })
  }
  // 건너뛰기(Esc): 듣는 중이면 요약을 멈추고, 창을 닫아 재생 버튼에서 기다린다. 재생은 하지 않는다
  const onSkipSummary = () => {
    if (phase === 'playing') stopSummary()
    waitAtPlay('Space를 누르면 재생해요.')
  }
  // 창 없이 요약을 듣는 중(요약 '항상') Esc → 건너뛰기. 창이 있으면 창의 Esc 가 맡는다
  useEffect(() => {
    if (phase !== 'playing' || summaryInDialog) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        stopSummary()
      }
    }
    // 캡처: 아래 화면 Esc(크게 보기 끄기 등)보다 먼저 받아, 그쪽이 같은 Esc 를 또 처리하지 않게 한다
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [phase, summaryInDialog, stopSummary])

  /* ── 화면 진입 ── */
  const ready = summarySettled && descriptionQ.isFetched
  const dur = formatDurationSpoken(video.durationSec)
  // 진입 안내·포커스도 시작할 때의 요약 설정(startMode)으로 정한다 (보는 도중 설정을 바꿔도 다시 나오지 않게)
  const entryText =
    `영상 보기예요. ${video.title}, ${dur}. ` +
    (summaryMode === 'ASK'
      ? '30초 요약을 들을까요? Enter는 듣기, Esc는 건너뛰기.'
      : summaryMode === 'ALWAYS'
        ? '30초 요약을 먼저 들려 드려요.'
        : '재생 버튼에 있어요. Space로 재생해요.')
  usePageEntry({
    title: video.title,
    announce: entryText,
    focusRef: summaryMode === 'NEVER' ? playRef : headingRef,
    ready: ready && startMode !== null,
  })

  /* ── 즐겨찾기 (상세 캐시를 먼저 바꾸고 실패하면 되돌린다) ── */
  const favorite = useMutation({
    mutationFn: () => (video.isFavorite ? favoritesApi.remove(videoId) : favoritesApi.add(videoId)),
    // 바꾸기 전 값을 context 로 넘긴다. onError 에서 video.isFavorite 를 읽으면 이미 뒤집힌 값이라 되돌리지 못한다
    onMutate: () => {
      const prev = queryClient.getQueryData<VideoDetail>(queryKeys.video(videoId))?.isFavorite
      queryClient.setQueryData<VideoDetail>(queryKeys.video(videoId), (old) =>
        old ? { ...old, isFavorite: !old.isFavorite } : old,
      )
      return { prev }
    },
    onSuccess: (res) => {
      announce(res.isFavorite ? '즐겨찾기에 넣었어요.' : '즐겨찾기에서 뺐어요.')
      // 다른 화면의 목록도 새로 받게 표시한다: 홈·검색(['videos']), 내 영상의 즐겨찾기 탭·개수(['favorites']),
      // 요청·올린 영상 목록의 즐겨찾기 표시(['me', 'videos']). 빠뜨리면 뒤로 가기 때 옛 목록이 보인다
      void queryClient.invalidateQueries({ queryKey: ['videos'] })
      void queryClient.invalidateQueries({ queryKey: ['favorites'] })
      void queryClient.invalidateQueries({ queryKey: ['me', 'videos'] })
    },
    onError: (e, _vars, context) => {
      const prev = context?.prev
      if (prev !== undefined)
        queryClient.setQueryData<VideoDetail>(queryKeys.video(videoId), (old) =>
          old ? { ...old, isFavorite: prev } : old,
        )
      announce(`즐겨찾기를 바꾸지 못했어요. ${toUserMessage(e)}`, { politeness: 'assertive' })
    },
  })

  /* ── 신고 (여는 동안 영상을 멈춘다) ── */
  const reportResume = useRef(false)
  const openReport = useCallback(() => {
    // 해설을 읽느라 잠깐 멈춰 둔 상태도 '재생 중'으로 본다
    const wasHolding = interrupt(false)
    const wasPlaying = state.playing || wasHolding
    reportResume.current = wasPlaying
    controls.pause()
    setReport({ line: currentLine, ms: state.currentMs })
    // 창이 열리면 포커스가 첫 사유(라디오)로 가서 문장 글은 읽히지 않는다. 신고할 문장을 안내로 먼저 읽어 준다.
    // 원래 멈춰 있던 영상이면 '멈췄어요'라고 하지 않는다
    announce(
      (currentLine
        ? `이 문장 신고 창이에요. 신고할 문장, ${currentLine.text}`
        : '이 문장 신고 창이에요. 아직 읽은 문장이 없어요.') +
        (wasPlaying ? ' 영상은 멈췄어요.' : ''),
    )
  }, [state.playing, state.currentMs, currentLine, interrupt, controls, announce])
  const closeReport = () => {
    setReport(null)
    if (reportResume.current) controls.play()
    reportResume.current = false
  }

  /* ── 재생 설정 (재생 중이었으면 여는 동안 멈추고 닫으면 이어서 재생. 멈춰 있었으면 그대로) ──
   * 창 안의 안내를 낭독기가 읽는 동안 영상·해설 소리가 겹치지 않게 한다 (원칙 1장, 2026-11-06 변경) */
  const settingsResume = useRef(false)
  const openSettings = useCallback(() => {
    const wasHolding = interrupt(false)
    const wasPlaying = state.playing || wasHolding
    settingsResume.current = wasPlaying
    if (wasPlaying) {
      controls.pause()
      announce('영상을 멈췄어요. 창을 닫으면 이어서 재생해요.')
    }
    setSettingsOpen(true)
  }, [state.playing, interrupt, controls, announce])
  const closeSettings = () => {
    setSettingsOpen(false)
    if (settingsResume.current && !state.ended) {
      controls.play()
      announce('이어서 재생해요.')
    }
    settingsResume.current = false
  }

  /*
   * 다시 듣기·요약·장면 설명·자세히 읽기처럼 영상을 멈추고 따로 읽는 소리. 읽는 동안에는 Esc('답 멈추기')로 멈출 수 있다.
   * resume:false 면 다 읽은 뒤 이어서 재생하지 않는다 (챗봇 명령으로 읽을 때: 챗봇 응답 뒤에는 자동 재생하지 않는다)
   */
  const asideRef = useRef(0)
  const readAside = useCallback(
    async (fn: () => Promise<unknown>, opts?: { resume?: boolean }) => {
      asideRef.current += 1
      try {
        return await holdWhile(fn, opts)
      } finally {
        asideRef.current -= 1
      }
    },
    [holdWhile],
  )

  /* ── 지금 장면 설명 (ASK-03, Alt+Shift+D) ── */
  const describeScene = useCallback(async () => {
    try {
      const s = await videosApi.sceneAt(videoId, state.currentMs)
      await readAside(() =>
        narrator.say({ text: `${s.title} 장면. ${s.sceneDescription}`, rate: settings.speechRate }),
      )
    } catch (e) {
      announce(
        e instanceof ApiError && e.code === 'DESC_002'
          ? '이 구간은 해설이 없어요.'
          : toUserMessage(e),
        { politeness: 'assertive' },
      )
    }
  }, [videoId, state.currentMs, readAside, narrator, settings.speechRate, announce])

  /**
   * 기능 실행 (CTL-04). 처리하지 못한 기능이면 null.
   * 처리했으면 실제 결과 문장(said)과 '그 장면 보기'로 갈 시각(goToMs, 장면 이동일 때)을 돌려준다.
   * 안내(전광판)는 여기서 하고, 챗봇은 같은 문장을 답 말풍선·'다시 듣기'에 쓴다.
   * fromChat: 챗봇 명령이면 읽은 뒤 이어서 재생하지 않는다 (챗봇 응답 뒤 자동 재생 없음)
   */
  const runAction = useCallback(
    (
      code: ChatActionCode,
      { fromChat = false }: { fromChat?: boolean } = {},
    ): ActionResult | null => {
      const scenes = description?.scenes ?? []
      const resume = !fromChat
      const tell = (said: string, goToMs: number | null = null): ActionResult => {
        announce(said)
        return { said, goToMs }
      }
      switch (code) {
        case 'PLAY':
          if (playingNow) return tell('이미 재생 중이에요.')
          toggle()
          return {
            said: state.error ?? (state.ready ? '재생해요.' : '영상을 불러오는 중이에요.'),
            goToMs: null,
          }
        case 'PAUSE':
          // 말로 물을 때는 듣기 시작에서 이미 멈춰 두었다. 그래도 사용자 입장에선 '멈췄다'가 결과다
          if (playingNow) toggle()
          else announce('멈췄어요.')
          return { said: '멈췄어요.', goToMs: null }
        case 'CURRENT_POSITION':
          return tell(
            `${formatPositionSpoken(state.currentMs)}.${scene ? ` ${scene.title} 장면.` : ''}`,
          )
        case 'NEXT_SCENE': {
          const next = scenes.find((s) => s.startMs > state.currentMs)
          if (!next) return tell('마지막 장면이에요.')
          const said = `다음 장면, ${next.title}, ${formatPositionSpoken(next.startMs)}.`
          seekTo(next.startMs, said)
          return { said, goToMs: next.startMs }
        }
        case 'PREV_SCENE': {
          const prev = [...scenes].reverse().find((s) => s.startMs < state.currentMs - 1500)
          const said = prev
            ? `이전 장면, ${prev.title}, ${formatPositionSpoken(prev.startMs)}.`
            : '처음으로 옮겼어요.'
          const to = prev?.startMs ?? 0
          seekTo(to, said)
          return { said, goToMs: to }
        }
        case 'PLAY_SUMMARY': {
          if (!summary) return tell('이 영상은 요약이 없어요.')
          const said = '30초 요약을 들려 드릴게요.'
          asideRef.current += 1
          void playSummary(said, { resume }).finally(() => {
            asideRef.current -= 1
          })
          return { said, goToMs: null }
        }
        case 'READ_DETAIL':
          return narration.readDetail({ resume, hold: readAside })
            ? { said: '화면 글자를 자세히 읽어 드릴게요.', goToMs: null }
            : tell('지금 화면에 긴 글이 없어요.')
        case 'HELP':
          // 도움말 창이 열리며 창 이름을 읽으므로 따로 안내하지 않는다
          setHelpOpen(true)
          return { said: '단축키 도움말을 열었어요.', goToMs: null }
        case 'OPEN_CHAPTERS':
          // 크게 보기에는 목차 탭이 없으니 작게 보기로 돌아가 연다
          setEnlarged(false)
          setTab('chapters')
          // 포커스는 입력칸에 둔다 (원칙 9장). 목차가 어디 있는지 말로 알려 준다: 입력칸 → 보내기 → 음성 인식 → 목차 탭
          return tell('장면 목차를 열었어요. 입력칸에서 Tab을 세 번 누르면 목차 탭이에요.')
        case 'OPEN_SCRIPT':
          setEnlarged(false)
          setTab('script')
          return tell('해설 문장을 열었어요. 입력칸에서 Tab을 세 번 누르면 해설 탭이에요.')
        case 'OPEN_HISTORY':
          // 질문 기록은 대화 칸에 늘 보인다
          return tell('질문 기록은 질문 입력칸 위 대화 칸에 있어요.')
        case 'FAVORITE_ADD':
          if (video.isFavorite) return tell('이미 즐겨찾기에 있어요.')
          // 결과 안내('즐겨찾기에 넣었어요' / 실패)는 저장이 끝나면 한다
          favorite.mutate()
          return { said: '즐겨찾기에 넣을게요.', goToMs: null }
        case 'FAVORITE_REMOVE':
          if (!video.isFavorite) return tell('즐겨찾기에 없는 영상이에요.')
          favorite.mutate()
          return { said: '즐겨찾기에서 뺄게요.', goToMs: null }
        case 'REPLAY_TUTORIAL':
          navigate('/tutorial/1')
          return { said: '튜토리얼로 이동해요.', goToMs: null }
        case 'REPEAT_LAST': {
          // 방금 읽은 해설·답변을 다시 (영상은 멈추고 읽는다)
          const last = narrator.last
          if (!last) return tell('다시 들을 문장이 없어요.')
          void readAside(() => narrator.say({ ...last, skipIfBusy: false }), { resume })
          return { said: '방금 읽은 문장을 다시 들려 드릴게요.', goToMs: null }
        }
        case 'UNDO_SEEK': {
          const back = beforeSeekRef.current
          if (back == null) return tell('되돌릴 이동이 없어요.')
          const said = `이동하기 전 위치, ${withRo(formatPositionSpoken(back))} 돌아왔어요.`
          seekTo(back, said)
          return { said, goToMs: back }
        }
        case 'STOP_SPEAKING':
          // 읽던 소리만 멈춘다. 해설 때문에 영상을 멈춰 뒀으면 이어서 재생한다 (챗봇 명령이면 멈춘 채로 둔다)
          interrupt(resume)
          return tell('읽던 소리를 멈췄어요.')
        default:
          return null
      }
    },
    [
      description,
      playingNow,
      state.currentMs,
      state.error,
      state.ready,
      scene,
      summary,
      toggle,
      seekTo,
      narrator,
      readAside,
      interrupt,
      playSummary,
      narration,
      setHelpOpen,
      video.isFavorite,
      favorite,
      navigate,
      announce,
    ],
  )

  /* ── 시청 화면 단축키 (Alt+Shift + 키, catalog.ts). 요약을 묻거나 읽는 동안에는 재생·이동을 막는다 ── */
  const summaryBusy = phase === 'asking' || phase === 'playing'
  useShortcutEntry(
    'play',
    () => {
      if (summaryBusy) announce('요약이 끝나면 재생할 수 있어요.')
      else toggle()
    },
    { scope: 'user' },
  )
  useShortcutEntry(
    'seek',
    (key) => {
      if (summaryBusy) return
      const step = settings.seekStepSec * 1000
      const max = state.durationMs || Number.MAX_SAFE_INTEGER
      const target = Math.min(max, Math.max(0, state.currentMs + (key === 'J' ? -step : step)))
      seekTo(target)
    },
    { scope: 'user' },
  )
  useShortcutEntry('position', () => void runAction('CURRENT_POSITION'), { scope: 'user' })
  useShortcutEntry('describe', () => void describeScene(), { scope: 'user' })
  useShortcutEntry('detail', (key) => setDetail(Number(key) as 1 | 2 | 3), { scope: 'user' })
  useShortcutEntry('settings', () => openSettings(), { scope: 'user' })
  useShortcutEntry('report', () => openReport(), { scope: 'user' })

  const ask = useAsk(
    {
      videoId,
      descriptionId: video.descriptionId!,
      narrator,
      speechRate: settings.speechRate,
      getCurrentMs: () => state.currentMs,
      // 다시 듣기도 Esc('답 멈추기')로 멈출 수 있게 readAside 로 읽는다
      holdWhile: readAside,
      // 렌더를 기다리지 않는 값: 답이 끝나 멈춤을 막 거둔 순간에도 맞게 본다
      isPlaying: () => state.playing || narration.isHoldingNow(),
      seekTo,
      updateSettings: update,
      runAction,
      searchVideos: (query) => {
        announce(`'${query}' 영상을 찾아요.`)
        navigate(`/search?q=${encodeURIComponent(query)}`)
      },
      announce,
      // 전체 화면에서는 질문 칸이 보이지 않는다. 포커스를 옮기면 '전체 화면 끝내기'로 튕기므로 그대로 둔다
      focusInput: () => {
        if (!document.fullscreenElement) inputRef.current?.focus()
      },
      // 질문 기록은 대화 칸에 늘 보여서 따로 열 것이 없다
      showHistory: () => {},
    },
    // 질문 기록은 이 화면에 있는 동안 한 것만 보여 준다. 나갔다 들어오면 비어 있다 (서버 기록은 불러오지 않는다)
    NO_HISTORY,
  )

  useEffect(() => {
    stopAnswerRef.current = ask.stopAnswer
  }, [ask.stopAnswer])

  /*
   * 말로 질문: 듣는 동안 영상을 멈추고, 취소하면 이어서 재생한다.
   * 질문을 보낸 뒤에는 답(또는 명령 실행)이 끝나도 이어서 재생하지 않는다. 듣기 전에 재생 중이었든 멈춰 있었든
   * 영상은 멈춘 채로 두고 '재생하려면 Alt+Shift+K' 를 알려 준다 (챗봇 응답 뒤 자동 재생 없음)
   */
  const onListenStart = useCallback(() => {
    // 해설을 읽느라 잠깐 멈춰 둔 상태도 '재생 중'으로 본다 (취소하면 이어서 재생)
    const wasHolding = interrupt(false)
    if (resumeAfterVoice.current == null) resumeAfterVoice.current = state.playing || wasHolding
    controls.pause()
  }, [state.playing, interrupt, controls])
  /** 듣기를 취소했거나 알아듣지 못함: 원래 재생 중이었으면 이어서 재생한다. 재생했으면 true */
  const onListenAbort = useCallback(() => {
    const resume = resumeAfterVoice.current === true && !state.ended
    if (resume) controls.play()
    resumeAfterVoice.current = null
    return resume
  }, [controls, state.ended])
  const onAsk = useCallback(
    (text: string, mode: 'TEXT' | 'VOICE') => {
      // 질문이든 명령(장면 이동·설정)이든 대화 칸의 질문 기록에 쌓인다. 포커스는 입력칸에 그대로 둔다
      resumeAfterVoice.current = null
      void ask.send(text, mode)
    },
    [ask],
  )

  /* ── 크게 보기 / Esc ── */
  /* ── 전체 화면: 영상 + 검은 하단 바(해설·재생·재생바·끝내기)만 화면을 채운다 (저시력) ── */
  const fsRef = useRef<HTMLDivElement>(null)
  const fsButtonRef = useRef<HTMLButtonElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled === true
  const fsWasOn = useRef(false)
  useEffect(() => {
    const onChange = () => {
      const on = fsRef.current != null && document.fullscreenElement === fsRef.current
      if (on === fsWasOn.current) return // 우리 영역이 아닌 전체 화면(예: YouTube 자체) 은 건드리지 않는다
      fsWasOn.current = on
      setFullscreen(on)
      if (on) {
        announce('전체 화면이에요. 영상과 해설, 재생 버튼만 보여요. Esc를 누르면 끝나요.')
      } else {
        announce('전체 화면을 끝냈어요.')
        fsButtonRef.current?.focus()
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [announce])
  // 전체 화면 중에는 보이지 않는 바깥(질문 칸·탭 등)으로 포커스가 빠지지 않게 되돌린다
  useEffect(() => {
    if (!fullscreen) return
    const onFocusIn = (e: FocusEvent) => {
      if (fsRef.current && !fsRef.current.contains(e.target as Node)) fsButtonRef.current?.focus()
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [fullscreen])
  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined)
      return
    }
    try {
      await fsRef.current?.requestFullscreen()
    } catch {
      announce('이 브라우저에서는 전체 화면을 쓸 수 없어요.', { politeness: 'assertive' })
    }
  }, [announce])

  // 크게/작게 보기 버튼은 자리가 바뀌며 새로 그려진다. 포커스가 사라졌으면 새 버튼으로 옮긴다
  const enlargeRef = useRef<HTMLButtonElement>(null)
  const enlargedBefore = useRef(enlarged)
  useEffect(() => {
    if (enlargedBefore.current === enlarged) return
    enlargedBefore.current = enlarged
    const lost = !document.activeElement || document.activeElement === document.body
    if (lost) enlargeRef.current?.focus()
  }, [enlarged])

  const toggleEnlarge = () => {
    setEnlarged((v) => !v)
    announce(
      enlarged
        ? '작게 보기로 돌아왔어요. 목차와 해설이 다시 보여요.'
        : '크게 보기로 바꿨어요. 목차와 해설은 숨기고 질문만 오른쪽에 남겼어요. Esc를 누르면 원래대로 돌아가요.',
    )
  }
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return
      // 음성 질문 취소·요약 건너뛰기가 먼저 받은 Esc 면 여기서는 하지 않는다 (크게 보기까지 함께 꺼지지 않게)
      if (e.defaultPrevented) return
      // 전체 화면의 Esc 는 브라우저가 '전체 화면 끝내기'로 쓴다
      if (document.fullscreenElement) return
      if (ask.stopAnswer()) return
      // 다시 듣기·요약·장면 설명·자세히 읽기를 듣는 중이면 그 소리를 멈춘다 ('Esc 답 멈추기')
      if (asideRef.current > 0 && narrator.busy) {
        narrator.stop()
        announce('읽던 소리를 멈췄어요.')
        return
      }
      if (enlarged) {
        setEnlarged(false)
        announce('작게 보기로 돌아왔어요. 목차와 해설이 다시 보여요.')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enlarged, ask, announce, narrator])

  // 플레이어 영역 안에서 버튼이 아닌 곳에 있을 때 Space 로 재생·멈춤.
  // 1/2/3·F 같은 한 글자 키는 낭독기의 제목·입력칸 이동 키와 겹쳐 빼고 Alt+Shift 단축키로 옮겼다 (원칙 5장)
  const onPlayerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTyping(e.target)) return
    const onButton = e.target instanceof HTMLElement && e.target.closest('button, [role="slider"]')
    if (e.key === ' ' && !onButton) {
      e.preventDefault()
      toggle()
    }
  }

  /**
   * 대본에서 문장을 골랐을 때: 그 시각으로 옮기고 그 문장을 해설 음성으로 읽는다.
   * 안내 전광판(낭독기가 읽는다)에는 위치만 짧게 — 문장까지 넣으면 낭독기와 해설 음성이 같은 문장을 겹쳐 읽는다 (원칙 1장).
   * 설정상 해설 음성이 읽지 않을 때만(해설 끄기, 외국어 번역 읽기 끄기) 문장을 전광판에 함께 넣는다.
   * readLine 은 seekTo(interrupt → seek → markSeek) 뒤에 불러야 끊기지 않고, 다음 tick 이 또 읽지도 않는다.
   */
  const onPickLine = (l: NarrationLine) => {
    const willRead = narration.willRead(l)
    const at = formatPositionSpoken(l.startMs)
    seekTo(l.startMs, willRead ? `${withRo(at)} 옮겼어요.` : `${at}. ${l.text}`)
    readLine(l)
  }

  const descError = descriptionQ.error
  const playbackError = playbackQ.error

  // 장면 후보를 고르는 중이면 질문 기록 끝에 같은 모양(나 + AudiSay 답)으로 붙는다
  const historyPanel = (
    <HistoryPanel
      entries={ask.entries}
      onReplay={ask.replay}
      onGoTo={seekTo}
      offer={ask.offer}
      onAnswerOffer={(reply) => onAsk(reply === 'yes' ? '네' : '아니요', 'TEXT')}
      answering={ask.busy}
      replayingKey={ask.replayingKey}
      onStop={() => {
        // 버튼이 사라지며 포커스가 본문으로 빠지지 않게 입력칸으로 (Esc 로 멈출 때와 같은 자리)
        if (ask.stopAnswer()) inputRef.current?.focus()
      }}
      tail={
        ask.pending && (
          <CandidatesPanel
            key={ask.pending.chatLogId}
            utterance={ask.pending.utterance}
            videoTimeMs={ask.pending.videoTimeMs}
            candidates={ask.pending.candidates}
            onChoose={ask.chooseCandidate}
            onNone={ask.dismissCandidates}
          />
        )
      }
    />
  )

  return (
    <div
      className={cn(
        'grid items-start',
        // 왼쪽: 영상·해설·조작(2행) · 목차와 대본(3행) / 오른쪽: 대화 칸(질문 기록 + 입력칸, 2~3행).
        // 읽는 순서(DOM)는 제목 → 영상·조작 → 대화 칸 → 목차와 대본이다 (원칙 3장: 질문 입력칸이 패널 탭보다 앞).
        // 목차·대본 목록이 길어도 입력칸까지 Tab 횟수가 늘지 않게 하려는 것이고, 눈에 보이는 배치는 자리 지정으로 그대로 둔다.
        // 3행을 1fr 로 두어 대화 칸이 길 때 남는 높이가 2행(조작 아래)이 아니라 3행으로 가게 한다
        'lg:grid-rows-[auto_auto_1fr]',
        // 크게 보기: 화면 양옆 여백까지 써서 영상을 넓게
        // 보통: 대화 칸 33rem. 글자 크기 3·배율 100%·화면 폭 1440px(스크롤바 포함)에서도 아래 조작 줄이 한 줄에 들어가게
        // 글자 크기 4·5단계: rem 이 커지는 만큼 대화 칸이 그대로 넓어지면 영상이 너무 좁아진다.
        // 3단계 대비 늘어나는 폭을 절반만 두고, 나머지는 영상 쪽(1fr)으로 돌린다 (영상 높이는 16:9 라 폭을 따라 커진다)
        //   보통 528px(3) → 594px(4, 원래 660) → 660px(5, 원래 792) / 크게 보기 448px → 504px(원래 560) → 560px(원래 672)
        enlarged
          ? 'gap-x-[49px] gap-y-5 lg:-mx-10 lg:grid-cols-[minmax(0,1fr)_28rem] fs4:lg:grid-cols-[minmax(0,1fr)_504px] fs5:lg:grid-cols-[minmax(0,1fr)_560px]'
          : 'gap-x-10 gap-y-5 lg:grid-cols-[minmax(0,1fr)_33rem] fs4:lg:grid-cols-[minmax(0,1fr)_594px] fs5:lg:grid-cols-[minmax(0,1fr)_660px]',
      )}
    >
      {/* 제목: 두 칸 위에 걸쳐 있어 아래 영상과 대화 칸의 윗선이 맞는다 */}
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-[1.75rem] leading-tight font-bold outline-none lg:col-span-2"
      >
        {video.title}
      </h1>

      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- 영역 단축키(1/2/3·Space). 포커스 가능한 자식들이 받는다 */}
      <div onKeyDown={onPlayerKeyDown} className="min-w-0 lg:col-start-1 lg:row-start-2">
        {/* 전체 화면이 되는 영역. 평소에는 모양이 없고, 전체 화면이면 영상이 위를 채우고 아래에 검은 하단 바가 붙는다 */}
        <div
          ref={fsRef}
          className={cn(fullscreen && 'flex flex-col bg-black [&_*:focus-visible]:outline-yellow')}
        >
          <VideoStage
            playback={playbackQ.data}
            videoRef={videoRef}
            ytHostRef={ytHostRef}
            volume={settings.originalVolume}
            fill={fullscreen}
            // 마우스로 영상을 눌러도 재생 버튼과 같은 처리 (요약 듣는 중에는 재생 버튼처럼 막는다)
            onClick={() => {
              if (summaryBusy) announce('요약이 끝나면 재생할 수 있어요.')
              else toggle()
            }}
          />
          <div className={cn(fullscreen && 'shrink-0 px-6 pb-5')}>
            {!fullscreen && !playbackError && state.error && (
              <p role="alert" className="mt-3 text-lg text-danger">
                {state.error}
              </p>
            )}
            {!fullscreen && playbackError && (
              <p role="alert" className="mt-3 text-lg text-danger">
                영상을 불러오지 못했어요. {toUserMessage(playbackError)}
              </p>
            )}
            {!fullscreen && descError && (
              <p role="alert" className="mt-3 text-lg text-danger">
                해설을 불러오지 못했어요. {toUserMessage(descError)}
              </p>
            )}

            <div className="mt-3">
              <NarrationBox
                line={currentLine}
                started={started}
                enlarged={enlarged}
                fullscreen={fullscreen}
              />
            </div>

            {/* 플레이어 컨트롤: 재생·멈춤 + 재생바. 폭이 좁으면 화면 크기 버튼만 다음 줄로 내린다 */}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
              <Button
                ref={playRef}
                // 재생 중(일시정지 버튼)은 흰 바탕으로 바꿔 글자뿐 아니라 모양으로도 상태가 보이게 한다
                // 해설을 읽느라 잠깐 멈춘 동안에도 '일시정지'로 둔다 (문장마다 글자가 바뀌지 않게)
                variant={playingNow ? 'secondary' : 'primary'}
                onClick={toggle}
                aria-keyshortcuts="Alt+Shift+K Space"
                disabled={phase === 'asking' || phase === 'playing' || state.error !== null}
                className={cn(CONTROL, playingNow && 'text-[#1f2a44]! hc:text-navy!')}
              >
                {playingNow ? '일시정지' : '재생'}
              </Button>
              <SeekBar
                currentMs={state.currentMs}
                durationMs={state.durationMs}
                stepSec={settings.seekStepSec}
                onSeek={(ms) => {
                  if (!seekBurstRef.current) beforeSeekRef.current = state.currentMs
                  seekBurstRef.current = true
                  interrupt()
                  controls.seek(ms)
                  markSeek(ms)
                }}
                onSeekSettled={(ms) => {
                  seekBurstRef.current = false
                  const at = sceneAtMs(description?.scenes, ms)
                  announce(
                    `${withRo(formatPositionSpoken(ms))} 옮겼어요.${at ? ` ${at.title} 장면.` : ''}`,
                  )
                }}
                tone={fullscreen ? 'dark' : 'light'}
                // 요약을 묻거나 듣는 동안에는 J·L 처럼 재생바도 막는다 (요약이 끊기지 않게)
                disabled={summaryBusy}
                className="min-w-[14rem] flex-1"
              />
              {/* 화면 크기 버튼 둘은 아래 줄의 신고·설정 버튼과 같은 크기·간격이라 세로로 줄이 맞는다 */}
              <div className="ml-auto flex gap-2">
                {!fullscreen && (
                  <Button
                    ref={enlargeRef}
                    variant="secondary"
                    onClick={toggleEnlarge}
                    aria-keyshortcuts={enlarged ? 'Escape' : undefined}
                    className={CONTROL}
                  >
                    {enlarged ? '작게 보기' : '크게 보기'}
                  </Button>
                )}
                <Button
                  ref={fsButtonRef}
                  variant="secondary"
                  onClick={() => void toggleFullscreen()}
                  disabled={!canFullscreen}
                  aria-keyshortcuts={fullscreen ? 'Escape' : undefined}
                  className={fullscreen ? CONTROL_WIDE : CONTROL}
                >
                  {fullscreen ? '전체 화면 끝내기' : '전체 화면'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* 크게 보기에서는 아래 줄을 숨긴다. 상세도 묶음 이름은 낭독기에만 읽힌다 (버튼 글자에 '해설'이 있어 화면에서는 뺐다) */}
        {!enlarged && (
          // 두 묶음: 왼쪽 해설 상세도(한 덩어리 선택) · 오른쪽 보조 버튼(연한 테두리, 조금 낮게). 묶음 사이는 넓게
          // 상세도 묶음 332 + 사이 32 이상 + 보조 버튼 340 = 704. 왼쪽 칸은 화면 폭 1440px(스크롤바 17px 포함)에서 727px,
          // 그보다 넓은 화면에서는 744px 라 한 줄에 들어가고 남는 폭만큼 묶음 사이가 벌어진다
          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <ChoiceGroup
              legend="해설 상세도"
              hideLegend
              appearance="segmented"
              className="relative"
              options={DETAIL_OPTIONS}
              value={settings.detailLevel}
              onChange={setDetail}
              optionClassName="w-[6.5rem] px-1 text-xl"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant={video.isFavorite ? 'starred' : 'secondary'}
                onClick={() => favorite.mutate()}
                disabled={favorite.isPending}
                // 신고·설정과 같은 폭. '즐겨찾기 해제'는 이 폭에 딱 맞아 좌우 여백만 줄인다
                className={cn(SUB_CONTROL, 'w-[6.75rem]', video.isFavorite && 'px-1!')}
              >
                {video.isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
              </Button>
              <Button
                variant="secondary"
                onClick={openReport}
                aria-keyshortcuts="Alt+Shift+X"
                className={cn(SUB_CONTROL, 'w-[6.75rem]')}
              >
                이 문장 신고
              </Button>
              <Button
                variant="secondary"
                onClick={openSettings}
                aria-keyshortcuts="Alt+Shift+S"
                className={cn(SUB_CONTROL, 'w-[6.75rem]')}
              >
                재생 설정
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 대화 칸: 넓은 화면에서는 스크롤해도 오른쪽에 붙어 있고, 입력칸은 늘 칸 맨 아래 같은 자리 */}
      {/* 좁은 화면(한 칸)에서는 목차와 대본 아래에 보이도록 맨 뒤로 보낸다 (지금까지와 같은 화면) */}
      <aside
        aria-label="질문"
        className="min-w-0 max-lg:order-1 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-2"
      >
        <AskPanel
          inputRef={inputRef}
          busy={ask.busy}
          onSubmit={onAsk}
          onListenStart={onListenStart}
          onListenAbort={onListenAbort}
          // 전체 화면에서는 질문 칸이 보이지 않아 녹음·답 흐름의 포커스가 튕긴다. 말로 묻기 전에 전체 화면을 끝내게 한다
          askBlockedReason={
            fullscreen
              ? '전체 화면에서는 질문할 수 없어요. Esc로 전체 화면을 끝낸 뒤 Alt+Shift+Q를 눌러 주세요.'
              : null
          }
          keyHint={!enlarged}
          // 넓은 화면: 스크롤해 붙었을 때 창 높이를 거의 다 쓰도록 길게 (처음 열면 아랫부분은 스크롤해서 본다)
          className="h-[44rem] lg:h-[clamp(36rem,calc(100dvh-3rem),64rem)]"
        >
          {historyPanel}
        </AskPanel>
      </aside>

      {/* 목차와 해설: 눈으로는 영상 바로 아래(왼쪽 3행), 읽는 순서는 대화 칸 뒤. 두 목록은 같은 줄 모양(왼쪽 시각 · 오른쪽 글 · 지금은 노랑)이다 */}
      {!enlarged && (
        <Tabs
          label="목차와 해설"
          appearance="buttons"
          value={tab}
          onChange={setTab}
          tabListClassName="grid-cols-2! sm:max-w-[22rem] [&_[role=tab]]:text-2xl"
          panelClassName="pt-4"
          className="mt-3 min-w-0 rounded-2xl border-2 border-line bg-paper p-5 lg:col-start-1 lg:row-start-3"
          items={[
            {
              value: 'chapters',
              label: '목차',
              panel: (
                <ChaptersPanel
                  chapters={chapters}
                  currentMs={state.currentMs}
                  onPick={(c) =>
                    seekTo(
                      c.startMs,
                      `${c.chapterIndex}. ${c.title} 장면이에요. ${formatPositionSpoken(c.startMs)}.`,
                    )
                  }
                />
              ),
            },
            {
              value: 'script',
              label: '해설',
              panel: (
                <ScriptPanel
                  lines={lines}
                  dubIds={dubIds}
                  // 대본의 '지금 문장'은 외국어 대사 번역도 포함한다 (대사를 누르면 그 줄이 노랗게)
                  current={currentScriptLine}
                  onPick={onPickLine}
                />
              ),
            },
          ]}
        />
      )}

      <SummaryDialog
        open={phase === 'asking' || summaryInDialog}
        summaryText={summary?.summary.text ?? null}
        onListen={onListenSummary}
        onSkip={onSkipSummary}
        focusAfterCloseRef={playRef}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={closeSettings}
        onPreview={() =>
          void narrator.say({
            text: '안녕하세요. 지금 설정한 속도로 해설을 읽어 드려요.',
            rate: settings.speechRate,
          })
        }
      />
      <ReportDialog
        open={report !== null}
        line={report?.line ?? null}
        reportedAtMs={report?.ms ?? 0}
        onClose={closeReport}
      />
    </div>
  )
}
