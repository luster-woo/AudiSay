import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
import { useShortcut, useShortcuts } from '@/features/shortcuts/context'
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
  { value: 1, label: '1 짧게' },
  { value: 2, label: '2 기본' },
  { value: 3, label: '3 자세히' },
]
type Tab = 'chapters' | 'script' | 'history'
/** 영상을 열고 요약을 어떻게 할지 정하는 단계 */
type SummaryPhase = 'loading' | 'asking' | 'playing' | 'done'

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)

/**
 * 시청 화면 본체. 영상 정보(해설 있음)를 받아 재생 주소·해설·목차·요약을 불러오고,
 * 플레이어 + 질문 패널을 그린다. 읽는 순서: 제목 → 플레이어 컨트롤 → 상세도 → 신고·설정·크게 보기 → 질문 → 패널 탭 (원칙 3장)
 */
export function Player({ video }: { video: VideoDetail }) {
  const videoId = video.videoId
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { settings, update } = useSettings()
  const { announce } = useAnnouncer()
  const { setHelpOpen } = useShortcuts()
  const [narrator] = useState(() => new Narrator())
  useEffect(() => () => narrator.stop(), [narrator])

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
  const { holdWhile, interrupt, currentLine, lines } = narration

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
  const start = useCallback(() => {
    setStarted(true)
    controls.play()
    // 요약 창이 닫히고(창이 포커스를 되돌린 뒤) 재생 버튼으로 옮긴다. 창이 열린 동안엔 바깥이 inert 라 포커스가 안 간다.
    // 브라우저 기본 스크롤은 화면을 크게 끌어올리므로, 버튼이 가려질 때만 최소한으로 스크롤한다
    requestAnimationFrame(() => {
      const el = playRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      const r = el.getBoundingClientRect()
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'nearest' })
    })
  }, [controls])

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

  const seekTo = useCallback(
    (ms: number, said?: string) => {
      interrupt()
      controls.seek(ms)
      const at = sceneAtMs(description?.scenes, ms)
      announce(said ?? `${formatPositionSpoken(ms)}로 옮겼어요.${at ? ` ${at.title} 장면.` : ''}`)
    },
    [interrupt, controls, description, announce],
  )

  const setDetail = useCallback(
    (level: 1 | 2 | 3) => {
      void update({ detailLevel: level })
      announce(`해설 상세도 ${DETAIL_OPTIONS.find((o) => o.value === level)?.label}.`)
    },
    [update, announce],
  )

  /* ── 30초 요약 (NAV-06) ── */
  const playSummary = useCallback(
    async (said: string) => {
      if (!summary) {
        announce('이 영상은 요약이 없어요.')
        return
      }
      announce(said)
      const say = () =>
        narrator.say({
          text: summary.summary.text,
          audioUrl: summary.summary.audioUrl,
          rate: settings.speechRate,
          refreshUrl: async () => (await summaryQ.refetch()).data?.summary.audioUrl ?? null,
        })
      if (started) await holdWhile(say)
      else await say()
    },
    [summary, narrator, settings.speechRate, summaryQ, started, holdWhile, announce],
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
    void playSummary('30초 요약을 먼저 들려 드려요. Esc를 누르면 건너뛰어요.').then(() => {
      setDecided('done')
      start()
    })
  }, [phase, decided, playSummary, start])

  const onListenSummary = () => {
    setDecided('playing')
    void playSummary('요약을 들려 드릴게요. Esc를 누르면 건너뛰어요.').then(() => {
      setDecided('done')
      start()
    })
  }
  const onSkipSummary = () => {
    setDecided('done')
    start()
    announce('바로 재생해요.')
  }
  // 요약을 듣는 중 Esc → 건너뛰기
  useEffect(() => {
    if (phase !== 'playing') return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        narrator.stop()
        announce('요약을 건너뛰어요.')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, narrator, announce])

  /* ── 화면 진입 ── */
  const ready = summarySettled && descriptionQ.isFetched
  const dur = formatDurationSpoken(video.durationSec)
  const entryText =
    `영상 보기예요. ${video.title}, ${dur}. ` +
    (settings.summaryMode === 'ASK' && summaryQ.isSuccess
      ? '30초 요약을 들을까요? Enter는 듣기, Esc는 바로 재생.'
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
    reportResume.current = state.playing
    interrupt(false)
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
  useShortcut('Alt+Shift+D', () => void describeScene(), {
    description: '지금 장면 설명 듣기',
    scope: 'user',
    allowInInput: true,
  })
  useShortcut('Alt+Shift+S', () => void playSummary('30초 요약을 들려 드릴게요.'), {
    description: '30초 요약 다시 듣기',
    scope: 'user',
    allowInInput: true,
  })

  /* ── 챗봇 명령 → 기능 실행 (CTL-04) ── */
  const runAction = useCallback(
    (code: ChatActionCode) => {
      const scenes = description?.scenes ?? []
      switch (code) {
        case 'PLAY':
          if (!state.playing) toggle()
          return
        case 'PAUSE':
          if (state.playing) toggle()
          return
        case 'CURRENT_POSITION':
          announce(
            `${formatPositionSpoken(state.currentMs)}. ${scene ? `${scene.title} 장면.` : ''}`,
          )
          return
        case 'NEXT_SCENE': {
          const next = scenes.find((s) => s.startMs > state.currentMs)
          if (next)
            seekTo(next.startMs, `다음 장면, ${next.title}, ${formatPositionSpoken(next.startMs)}.`)
          else announce('마지막 장면이에요.')
          return
        }
        case 'PREV_SCENE': {
          const prev = [...scenes].reverse().find((s) => s.startMs < state.currentMs - 1500)
          if (prev)
            seekTo(prev.startMs, `이전 장면, ${prev.title}, ${formatPositionSpoken(prev.startMs)}.`)
          else seekTo(0, '처음으로 옮겼어요.')
          return
        }
        case 'PLAY_SUMMARY':
          void playSummary('30초 요약을 들려 드릴게요.')
          return
        case 'READ_DETAIL':
          if (!narration.readDetail()) announce('지금 화면에 긴 글이 없어요.')
          return
        case 'HELP':
          setHelpOpen(true)
          return
        case 'OPEN_CHAPTERS':
          setTab('chapters')
          announce('장면 목차를 열었어요.')
          return
        case 'OPEN_SCRIPT':
          setTab('script')
          announce('해설 대본을 열었어요.')
          return
        case 'OPEN_HISTORY':
          setTab('history')
          announce('질문 기록을 열었어요.')
          return
        case 'FAVORITE_ADD':
          if (!video.isFavorite) favorite.mutate()
          else announce('이미 즐겨찾기에 있어요.')
          return
        case 'FAVORITE_REMOVE':
          if (video.isFavorite) favorite.mutate()
          else announce('즐겨찾기에 없는 영상이에요.')
          return
        case 'REPORT':
          openReport()
          return
        case 'REPLAY_TUTORIAL':
          navigate('/tutorial/1')
          return
      }
    },
    [
      description,
      state.playing,
      state.currentMs,
      scene,
      toggle,
      seekTo,
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
  const toggleEnlarge = () => {
    setEnlarged((v) => !v)
    announce(
      enlarged
        ? '작게 보기로 돌아왔어요. 패널이 다시 보여요.'
        : '크게 보기로 바꿨어요. 패널은 숨겼어요. Esc를 누르면 원래대로 돌아가요.',
    )
  }
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return
      if (ask.stopAnswer()) return
      if (enlarged) {
        setEnlarged(false)
        announce('작게 보기로 돌아왔어요. 패널이 다시 보여요.')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enlarged, ask, announce])

  // 플레이어 영역 안에서만 1/2/3·Space 가 동작한다 (원칙 5장: 한 글자 키는 입력창·낭독기 키와 겹치지 않게)
  const onPlayerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTyping(e.target)) return
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      e.preventDefault()
      setDetail(Number(e.key) as 1 | 2 | 3)
      return
    }
    const onButton = e.target instanceof HTMLElement && e.target.closest('button, [role="slider"]')
    if (e.key === ' ' && !onButton) {
      e.preventDefault()
      toggle()
    }
  }

  const onPickLine = (l: NarrationLine) => {
    seekTo(l.startMs, `${formatPositionSpoken(l.startMs)}. ${l.text}`)
    if (settings.soundMix !== 'DIALOGUE_ONLY') {
      void narrator.say({ text: l.text, audioUrl: l.audioUrl, rate: settings.speechRate })
    }
  }

  const descError = descriptionQ.error
  const playbackError = playbackQ.error

  return (
    <div
      className={cn(
        'grid gap-10',
        enlarged ? 'mx-auto max-w-[70rem]' : 'lg:grid-cols-[minmax(0,1fr)_27.5rem]',
      )}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- 영역 단축키(1/2/3·Space). 포커스 가능한 자식들이 받는다 */}
      <div onKeyDown={onPlayerKeyDown} className="min-w-0">
        {/* 제목은 남는 폭에서 줄바꿈하고, 버튼은 늘 오른쪽에 고정 (버튼 글자가 바뀌어도 줄이 다시 나뉘지 않게) */}
        <div className="flex items-start gap-5">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="min-w-0 flex-1 text-[1.75rem] leading-tight font-bold outline-none"
          >
            {video.title}
          </h1>
          <Button
            variant={video.isFavorite ? 'on' : 'secondary'}
            onClick={() => favorite.mutate()}
            disabled={favorite.isPending}
            className="min-w-[11.5rem] shrink-0 whitespace-nowrap"
          >
            {video.isFavorite ? '즐겨찾기 해제' : '즐겨찾기에 넣기'}
          </Button>
        </div>

        <VideoStage
          playback={playbackQ.data}
          videoRef={videoRef}
          ytHostRef={ytHostRef}
          volume={settings.originalVolume}
          className="mt-5"
        />
        {playbackError && (
          <p role="alert" className="mt-3 text-lg text-danger">
            영상을 불러오지 못했어요. {toUserMessage(playbackError)}
          </p>
        )}
        {descError && (
          <p role="alert" className="mt-3 text-lg text-danger">
            해설을 불러오지 못했어요. {toUserMessage(descError)}
          </p>
        )}

        <div className="mt-3">
          <NarrationBox line={currentLine} started={started} enlarged={enlarged} />
        </div>

        {/* 플레이어 컨트롤: 재생·멈춤 + 재생바 */}
        <div className="mt-3 flex items-center gap-4">
          <Button
            ref={playRef}
            variant="primary"
            onClick={toggle}
            aria-keyshortcuts="Space"
            disabled={phase === 'asking' || phase === 'playing'}
            className="min-w-[6.5rem]"
          >
            {state.playing ? '일시정지' : '재생'}
          </Button>
          <SeekBar
            currentMs={state.currentMs}
            durationMs={state.durationMs}
            stepSec={settings.seekStepSec}
            onSeek={(ms) => {
              interrupt()
              controls.seek(ms)
            }}
            onSeekSettled={(ms) => {
              const at = sceneAtMs(description?.scenes, ms)
              announce(`${formatPositionSpoken(ms)}로 옮겼어요.${at ? ` ${at.title} 장면.` : ''}`)
            }}
            className="min-w-0 flex-1"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <ChoiceGroup
            legend="해설 상세도"
            options={DETAIL_OPTIONS}
            value={settings.detailLevel}
            onChange={setDetail}
          />
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={openReport}>
              이 문장 신고
            </Button>
            <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
              재생 설정
            </Button>
            <Button
              variant="secondary"
              onClick={toggleEnlarge}
              aria-keyshortcuts={enlarged ? 'Escape' : undefined}
            >
              {enlarged ? '작게 보기' : '크게 보기'}
            </Button>
          </div>
        </div>
      </div>

      {!enlarged && (
        <aside aria-label="질문과 패널" className="min-w-0">
          <AskPanel
            inputRef={inputRef}
            busy={ask.busy}
            onSubmit={onAsk}
            onListenStart={onListenStart}
            onListenAbort={onListenAbort}
          />
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
                panel: ask.pending ? (
                  <CandidatesPanel
                    utterance={ask.pending.utterance}
                    videoTimeMs={ask.pending.videoTimeMs}
                    candidates={ask.pending.candidates}
                    onChoose={ask.chooseCandidate}
                    onNone={ask.dismissCandidates}
                  />
                ) : (
                  <HistoryPanel entries={ask.entries} onReplay={ask.replay} onGoTo={seekTo} />
                ),
              },
            ]}
          />
        </aside>
      )}

      <SummaryDialog
        open={phase === 'asking'}
        summaryText={summary?.summary.text ?? null}
        recommend={summary?.recommendSummary ?? false}
        onListen={onListenSummary}
        onSkip={onSkipSummary}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
        }}
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
