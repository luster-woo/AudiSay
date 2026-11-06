import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { afterScreenChangeMs } from '@/features/search/speechLead'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { favoritesApi } from '@/api/favorites'
import { queryKeys } from '@/api/queryKeys'
import { videosApi } from '@/api/videos'
import { ApiError, toUserMessage } from '@/api/errors'
import type { ChatActionCode, NarrationLine, VideoDetail } from '@/api/types'
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
import { useShortcutEntry, useShortcuts } from '@/features/shortcuts/context'
import { withRo } from '@/utils/korean'
import { formatDurationSpoken, formatPositionSpoken } from '@/utils/time'
import { AskPanel } from './AskPanel'
import { NarrationBox } from './NarrationBox'
import { ReportDialog } from './ReportDialog'
import { SettingsDialog } from './SettingsDialog'
import { SummaryDialog } from './SummaryDialog'
import { entriesFromServer } from './history'
import { CandidatesPanel, ChaptersPanel, HistoryPanel, ScriptPanel } from './panels'
import { useAsk } from './useAsk'
import { VideoStage } from './VideoStage'

const DETAIL_OPTIONS: { value: 1 | 2 | 3; label: string }[] = [
  { value: 1, label: '1 짧은 해설' },
  { value: 2, label: '2 기본 해설' },
  { value: 3, label: '3 자세한 해설' },
]
type Tab = 'chapters' | 'script' | 'history'
/** 영상을 열고 요약을 어떻게 할지 정하는 단계 */
type SummaryPhase = 'loading' | 'asking' | 'playing' | 'done'

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)

/** 재생·해설 상세도·신고·설정·크게 보기: 같은 높이·폭·글자 크기 (글자가 바뀌어도 폭이 그대로) */
const CONTROL = 'w-[6.75rem] px-2! text-base whitespace-nowrap'
/** '전체 화면 끝내기'는 글자가 길어 조금 넓게 */
const CONTROL_WIDE = 'w-[9.5rem] px-2! text-base whitespace-nowrap'

/**
 * 시청 화면 본체. 영상 정보(해설 있음)를 받아 재생 주소·해설·목차·요약을 불러오고,
 * 플레이어 + 질문 패널을 그린다. 읽는 순서: 제목 → 플레이어 컨트롤 → 상세도 → 신고·설정·크게 보기 → 질문 → 패널 탭 (원칙 3장)
 */

export function Player({ video }: { video: VideoDetail }) {
  const videoId = video.videoId
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { settings, update } = useSettings()
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
  const historyQ = useQuery({
    queryKey: queryKeys.chatHistory(videoId),
    queryFn: () => videosApi.chatHistory(videoId),
    staleTime: Infinity,
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
  const { holdWhile, interrupt, currentLine, lines, markSeek, readLine } = narration

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
    if (state.playing) {
      interrupt(false)
      controls.pause()
      announce('멈췄어요.')
    } else {
      interrupt(false)
      setStarted(true)
      controls.play()
      announce('재생해요.')
    }
  }, [state.playing, interrupt, controls, announce])

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
  /** 요약을 들려준다. 끝까지 들었으면 true, 중간에 멈췄으면(건너뛰기·다시 듣기) false */
  const playSummary = useCallback(
    async (said: string) => {
      if (!summary) {
        announce('이 영상은 요약이 없어요.')
        return false
      }
      const gen = ++summaryGenRef.current
      announce(said)
      const say = async () => {
        // 안내를 다 들은 뒤에 요약 소리를 낸다. 기다리는 중 멈췄으면 요약은 내지 않는다
        await waitForReader(said)
        if (summaryGenRef.current !== gen) return
        await narrator.say({
          text: summary.summary.text,
          audioUrl: summary.summary.audioUrl,
          rate: settings.speechRate,
          refreshUrl: async () => (await summaryQ.refetch()).data?.summary.audioUrl ?? null,
        })
      }
      if (started) await holdWhile(say)
      else await say()
      return summaryGenRef.current === gen
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
   * 요약 창은 요약을 듣는 동안에도, 다 들은 뒤에도 그대로 둔다 (화면이 바뀌면 낭독기가 다시 읽어 소리가 겹친다).
   * 창은 '건너뛰기'(Esc)로만 닫고, 닫히면 재생하지 않고 재생 버튼에서 기다린다 (원칙 1장: 자동 재생 없음).
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
  const summaryMode = summaryQ.isSuccess ? settings.summaryMode : 'NEVER'
  const phase: SummaryPhase = !summarySettled
    ? 'loading'
    : (decided ??
      (summaryMode === 'ASK' ? 'asking' : summaryMode === 'ALWAYS' ? 'playing' : 'done'))
  const autoSummaryRef = useRef(false)
  useEffect(() => {
    if (phase !== 'playing' || decided !== null || autoSummaryRef.current) return
    autoSummaryRef.current = true
    void playSummary('30초 요약을 먼저 들려 드려요. Esc를 누르면 건너뛰어요.').then((done) =>
      waitAtPlay(done ? '요약이 끝났어요. Space를 누르면 재생해요.' : 'Space를 누르면 재생해요.'),
    )
  }, [phase, decided, playSummary, waitAtPlay])

  // 요약 듣고 시작: 창과 버튼은 그대로. 듣는 중에 다시 누르면 처음부터 다시 들려준다
  const onListenSummary = () => {
    if (phase === 'playing') stopSummary()
    setDecided('playing')
    setSummaryInDialog(true)
    void playSummary('요약을 들려 드릴게요.').then((done) => {
      if (!done) return // 건너뛰기·다시 듣기로 멈췄으면 그쪽에서 처리한다
      setDecided('done')
      announce('요약이 끝났어요. 다시 들으려면 Enter, 닫으려면 Esc.')
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
      if (e.key === 'Escape') {
        e.preventDefault()
        stopSummary()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, summaryInDialog, stopSummary])

  /* ── 화면 진입 ── */
  const ready = summarySettled && descriptionQ.isFetched
  const dur = formatDurationSpoken(video.durationSec)
  const entryText =
    `영상 보기예요. ${video.title}, ${dur}. ` +
    (settings.summaryMode === 'ASK' && summaryQ.isSuccess
      ? '30초 요약을 들을까요? Enter는 듣기, Esc는 건너뛰기.'
      : settings.summaryMode === 'ALWAYS' && summaryQ.isSuccess
        ? '30초 요약을 먼저 들려 드려요.'
        : '재생 버튼에 있어요. Space로 재생해요.')
  usePageEntry({
    title: video.title,
    announce: entryText,
    focusRef: settings.summaryMode === 'NEVER' || !summaryQ.isSuccess ? playRef : headingRef,
    ready,
  })

  /* ── 즐겨찾기 (상세 캐시를 먼저 바꾸고 실패하면 되돌린다) ── */
  const favorite = useMutation({
    mutationFn: () => (video.isFavorite ? favoritesApi.remove(videoId) : favoritesApi.add(videoId)),
    onMutate: () => {
      queryClient.setQueryData<VideoDetail>(queryKeys.video(videoId), (old) =>
        old ? { ...old, isFavorite: !old.isFavorite } : old,
      )
    },
    onSuccess: (res) => {
      announce(res.isFavorite ? '즐겨찾기에 넣었어요.' : '즐겨찾기에서 뺐어요.')
      void queryClient.invalidateQueries({ queryKey: ['videos'], exact: false })
    },
    onError: (e) => {
      queryClient.setQueryData<VideoDetail>(queryKeys.video(videoId), (old) =>
        old ? { ...old, isFavorite: video.isFavorite } : old,
      )
      announce(`즐겨찾기를 바꾸지 못했어요. ${toUserMessage(e)}`, { politeness: 'assertive' })
    },
  })

  /* ── 신고 (여는 동안 영상을 멈춘다) ── */
  const reportResume = useRef(false)
  const openReport = useCallback(() => {
    // 해설을 읽느라 잠깐 멈춰 둔 상태도 '재생 중'으로 본다
    const holding = interrupt(false)
    reportResume.current = state.playing || holding
    controls.pause()
    setReport({ line: currentLine, ms: state.currentMs })
    announce(
      currentLine
        ? '이 문장 신고 창이에요. 문장을 먼저 읽어 드려요. 영상은 멈췄어요.'
        : '이 문장 신고 창이에요. 아직 읽은 문장이 없어요.',
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
    const holding = interrupt(false)
    const wasPlaying = state.playing || holding
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

  /* ── 지금 장면 설명 (ASK-03, Alt+Shift+D) ── */
  const describeScene = useCallback(async () => {
    try {
      const s = await videosApi.sceneAt(videoId, state.currentMs)
      await holdWhile(() =>
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
  }, [videoId, state.currentMs, holdWhile, narrator, settings.speechRate, announce])

  /* ── 챗봇 명령 → 기능 실행 (CTL-04). 처리하지 못한 기능이면 false ── */
  const runAction = useCallback(
    (code: ChatActionCode): boolean => {
      const scenes = description?.scenes ?? []
      switch (code) {
        case 'PLAY':
          if (!state.playing) toggle()
          return true
        case 'PAUSE':
          if (state.playing) toggle()
          return true
        case 'CURRENT_POSITION':
          announce(
            `${formatPositionSpoken(state.currentMs)}. ${scene ? `${scene.title} 장면.` : ''}`,
          )
          return true
        case 'NEXT_SCENE': {
          const next = scenes.find((s) => s.startMs > state.currentMs)
          if (next)
            seekTo(next.startMs, `다음 장면, ${next.title}, ${formatPositionSpoken(next.startMs)}.`)
          else announce('마지막 장면이에요.')
          return true
        }
        case 'PREV_SCENE': {
          const prev = [...scenes].reverse().find((s) => s.startMs < state.currentMs - 1500)
          if (prev)
            seekTo(prev.startMs, `이전 장면, ${prev.title}, ${formatPositionSpoken(prev.startMs)}.`)
          else seekTo(0, '처음으로 옮겼어요.')
          return true
        }
        case 'PLAY_SUMMARY':
          void playSummary('30초 요약을 들려 드릴게요.')
          return true
        case 'READ_DETAIL':
          if (!narration.readDetail()) announce('지금 화면에 긴 글이 없어요.')
          return true
        case 'HELP':
          setHelpOpen(true)
          return true
        case 'OPEN_CHAPTERS':
          // 크게 보기에는 목차 탭이 없으니 작게 보기로 돌아가 연다
          setEnlarged(false)
          setTab('chapters')
          announce('장면 목차를 열었어요.')
          return true
        case 'OPEN_SCRIPT':
          setEnlarged(false)
          setTab('script')
          announce('해설 대본을 열었어요.')
          return true
        case 'OPEN_HISTORY':
          setTab('history')
          announce('질문 기록을 열었어요.')
          return true
        case 'FAVORITE_ADD':
          if (!video.isFavorite) favorite.mutate()
          else announce('이미 즐겨찾기에 있어요.')
          return true
        case 'FAVORITE_REMOVE':
          if (video.isFavorite) favorite.mutate()
          else announce('즐겨찾기에 없는 영상이에요.')
          return true
        case 'REPORT':
          openReport()
          return true
        case 'REPLAY_TUTORIAL':
          navigate('/tutorial/1')
          return true
        case 'REPEAT_LAST': {
          // 방금 읽은 해설·답변을 다시 (영상은 멈추고 읽은 뒤 이어서)
          const last = narrator.last
          if (!last) announce('다시 들을 문장이 없어요.')
          else void holdWhile(() => narrator.say({ ...last, skipIfBusy: false }))
          return true
        }
        case 'UNDO_SEEK': {
          const back = beforeSeekRef.current
          if (back == null) announce('되돌릴 이동이 없어요.')
          else seekTo(back, `이동하기 전 위치, ${withRo(formatPositionSpoken(back))} 돌아왔어요.`)
          return true
        }
        case 'STOP_SPEAKING':
          // 읽던 소리만 멈춘다. 해설 때문에 영상을 멈춰 뒀으면 이어서 재생한다
          interrupt()
          announce('읽던 소리를 멈췄어요.')
          return true
        default:
          return false
      }
    },
    [
      description,
      state.playing,
      state.currentMs,
      scene,
      toggle,
      seekTo,
      narrator,
      holdWhile,
      interrupt,
      playSummary,
      narration,
      setHelpOpen,
      video.isFavorite,
      favorite,
      openReport,
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

  const initialEntries = useMemo(
    () => (historyQ.data ? entriesFromServer(historyQ.data.messages) : []),
    [historyQ.data],
  )
  const ask = useAsk(
    {
      videoId,
      descriptionId: video.descriptionId!,
      narrator,
      speechRate: settings.speechRate,
      getCurrentMs: () => state.currentMs,
      holdWhile,
      seekTo,
      updateSettings: update,
      runAction,
      searchVideos: (query) => {
        announce(`'${query}' 영상을 찾아요.`)
        navigate(`/search?q=${encodeURIComponent(query)}`)
      },
      announce,
      focusInput: () => inputRef.current?.focus(),
      showHistory: () => setTab('history'),
    },
    initialEntries,
  )

  // 말로 질문: 듣는 동안 영상을 멈추고, 취소하면 이어서 재생. 답이 끝나면 holdWhile 이 이어서 재생한다
  const onListenStart = useCallback(() => {
    if (resumeAfterVoice.current == null) resumeAfterVoice.current = state.playing
    interrupt(false)
    controls.pause()
  }, [state.playing, interrupt, controls])
  const onListenAbort = useCallback(() => {
    if (resumeAfterVoice.current) controls.play()
    resumeAfterVoice.current = null
  }, [controls])
  const onAsk = useCallback(
    (text: string, mode: 'TEXT' | 'VOICE') => {
      // 질문이든 명령(장면 이동·설정)이든 입력을 마치면 질문 기록 탭을 보여 준다. 포커스는 입력칸에 그대로 둔다
      setTab('history')
      const resume = resumeAfterVoice.current
      resumeAfterVoice.current = null
      void ask.send(text, mode).finally(() => {
        // 질문이 아닌 명령(이동·설정)이면 holdWhile 을 거치지 않으므로 여기서 이어서 재생한다
        if (resume && !state.ended) controls.play()
      })
    },
    [ask, controls, state.ended],
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
        ? '작게 보기로 돌아왔어요. 목차와 대본이 다시 보여요.'
        : '크게 보기로 바꿨어요. 목차와 대본은 숨기고 질문만 오른쪽에 남겼어요. Esc를 누르면 원래대로 돌아가요.',
    )
  }
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return
      // 전체 화면의 Esc 는 브라우저가 '전체 화면 끝내기'로 쓴다
      if (document.fullscreenElement) return
      if (ask.stopAnswer()) return
      if (enlarged) {
        setEnlarged(false)
        announce('작게 보기로 돌아왔어요. 목차와 대본이 다시 보여요.')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enlarged, ask, announce])

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
   * '대사만' 설정이라 해설 음성이 읽지 않을 때만 문장을 전광판에 함께 넣는다.
   * readLine 은 seekTo(interrupt → seek → markSeek) 뒤에 불러야 끊기지 않고, 다음 tick 이 또 읽지도 않는다.
   */
  const onPickLine = (l: NarrationLine) => {
    const willRead = settings.soundMix !== 'DIALOGUE_ONLY'
    const at = formatPositionSpoken(l.startMs)
    seekTo(l.startMs, willRead ? `${at}로 옮겼어요.` : `${at}. ${l.text}`)
    readLine(l)
  }

  const descError = descriptionQ.error
  const playbackError = playbackQ.error

  const historyPanel = ask.pending ? (
    <CandidatesPanel
      utterance={ask.pending.utterance}
      videoTimeMs={ask.pending.videoTimeMs}
      candidates={ask.pending.candidates}
      onChoose={ask.chooseCandidate}
      onNone={ask.dismissCandidates}
    />
  ) : (
    <HistoryPanel entries={ask.entries} onReplay={ask.replay} onGoTo={seekTo} />
  )

  return (
    <div
      className={cn(
        'grid',
        // 크게 보기: 화면 양옆 여백까지 써서 영상을 넓게, 오른쪽 좁은 칸에는 질문(챗봇)만
        enlarged
          ? 'gap-[49px] lg:-mx-10 lg:grid-cols-[minmax(0,1fr)_380px]'
          : 'gap-10 lg:grid-cols-[minmax(0,1fr)_27.5rem]',
      )}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- 영역 단축키(1/2/3·Space). 포커스 가능한 자식들이 받는다 */}
      <div onKeyDown={onPlayerKeyDown} className="min-w-0">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[1.75rem] leading-tight font-bold outline-none"
        >
          {video.title}
        </h1>

        {/* 전체 화면이 되는 영역. 평소에는 모양이 없고, 전체 화면이면 영상이 위를 채우고 아래에 검은 하단 바가 붙는다 */}
        <div
          ref={fsRef}
          className={cn(
            fullscreen ? 'flex flex-col bg-black [&_*:focus-visible]:outline-yellow' : 'mt-5',
          )}
        >
          <VideoStage
            playback={playbackQ.data}
            videoRef={videoRef}
            ytHostRef={ytHostRef}
            volume={settings.originalVolume}
            fill={fullscreen}
          />
          <div className={cn(fullscreen && 'shrink-0 px-6 pb-5')}>
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
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
              <Button
                ref={playRef}
                // 재생 중(일시정지 버튼)은 흰 바탕으로 바꿔 글자뿐 아니라 모양으로도 상태가 보이게 한다
                variant={state.playing ? 'secondary' : 'primary'}
                onClick={toggle}
                aria-keyshortcuts="Alt+Shift+K Space"
                disabled={phase === 'asking' || phase === 'playing'}
                className={cn(CONTROL, state.playing && 'text-[#1f2a44]! hc:text-navy!')}
              >
                {state.playing ? '일시정지' : '재생'}
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
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            <ChoiceGroup
              legend="해설 상세도"
              hideLegend
              className="relative"
              options={DETAIL_OPTIONS}
              value={settings.detailLevel}
              onChange={setDetail}
              optionClassName={CONTROL}
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={openReport}
                aria-keyshortcuts="Alt+Shift+X"
                className={CONTROL}
              >
                이 문장 신고
              </Button>
              <Button
                variant="secondary"
                onClick={openSettings}
                aria-keyshortcuts="Alt+Shift+S"
                className={CONTROL}
              >
                재생 설정
              </Button>
            </div>
          </div>
        )}
      </div>

      <aside aria-label={enlarged ? '질문' : '질문과 패널'} className="min-w-0">
        <AskPanel
          inputRef={inputRef}
          busy={ask.busy}
          onSubmit={onAsk}
          onListenStart={onListenStart}
          onListenAbort={onListenAbort}
          extraAction={
            !enlarged && (
              <Button
                variant={video.isFavorite ? 'starred' : 'secondary'}
                size="panel"
                onClick={() => favorite.mutate()}
                disabled={favorite.isPending}
                className="whitespace-nowrap"
              >
                {video.isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
              </Button>
            )
          }
        />
        {enlarged ? (
          <div className="mt-6">{historyPanel}</div>
        ) : (
          <Tabs
            label="패널"
            appearance="buttons"
            value={tab}
            onChange={setTab}
            panelClassName="pt-5"
            className="mt-6"
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
                label: '대본',
                panel: <ScriptPanel lines={lines} current={currentLine} onPick={onPickLine} />,
              },
              {
                value: 'history',
                label: '질문 기록',
                panel: historyPanel,
              },
            ]}
          />
        )}
      </aside>

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
