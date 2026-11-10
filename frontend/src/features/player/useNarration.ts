import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { Description, NarrationLine, Scene, ScreenText, UserSettings } from '@/api/types'
import { estimateSpeechMs, type Narrator } from './Narrator'
import type { PlayerControls, PlayerState } from './usePlayerSource'

/** 시각을 넘어선 것으로 치지 않을 큰 이동(재생바 조작) 기준 */
const JUMP_MS = 2000

/** 화면 글자 중 지금 상세도·자막 설정에서 읽을 문구. 없으면 null (명세 CNT-03, SND-03) */
export function screenTextToRead(
  t: ScreenText,
  level: UserSettings['detailLevel'],
  subtitle: UserSettings['subtitleReading'],
): string | null {
  if (t.textType === 'SUBTITLE') {
    if (subtitle === 'OFF') return null
    if (subtitle === 'DIFFERENT_ONLY' && t.sameAsDialogue) return null
  }
  if (t.importance === 'HIGH') return level >= 2 ? (t.headline ?? t.fullText) : null
  if (t.importance === 'MEDIUM') return level === 3 ? t.summaryText : null
  return null
}

export const sceneAtMs = (scenes: Scene[] | undefined, ms: number) =>
  scenes?.find((s) => s.startMs <= ms && ms < s.endMs) ?? null

interface Options {
  description: Description | undefined
  state: PlayerState
  controls: PlayerControls
  settings: UserSettings
  narrator: Narrator
  /** 음성 주소가 만료됐을 때 해설을 다시 받아 그 문장의 새 주소를 준다 */
  refreshAudioUrl: (lineId: number) => Promise<string | null>
  /** 전광판 안내 (부분 해설 구간 끝 등) */
  announce: (text: string) => void
}

/**
 * 재생 시각에 맞춰 해설 문장·화면 글자를 읽는다.
 * - 자동(AUTO): 빈 구간보다 음성이 길면 영상을 멈추고 읽은 뒤 이어서 재생 (PLC-02)
 * - 영상과 함께(WITH_VIDEO): 멈추지 않고 겹쳐 읽는다. 겹치면 중요도 높은 문장이 남는다 (PLC-03)
 * - 멈추고(PAUSE_AFTER): 문장마다 영상을 멈추고 읽는다
 * 재생바로 옮긴 뒤에는 지나간 문장을 읽지 않고, 그 시각 이후에 만나는 문장부터 읽는다.
 */
export function useNarration({
  description,
  state,
  controls,
  settings,
  narrator,
  refreshAudioUrl,
  announce,
}: Options) {
  const level = settings.detailLevel
  /**
   * 상세도는 누적이다: 2 기본 = 1·2단계 문장 모두, 3 자세히 = 1·2·3단계 전부를 시각 순서로 읽는다.
   * (AI 가 단계마다 '덧붙이는' 문장을 만들므로 같은 단계만 고르면 대부분이 빠진다)
   */
  const lines = useMemo(
    () =>
      (description?.lines ?? [])
        .filter((l) => l.detailLevel <= level)
        .sort((a, b) => a.startMs - b.startMs || a.detailLevel - b.detailLevel),
    [description, level],
  )
  const screenTexts = useMemo(
    () => [...(description?.screenTexts ?? [])].sort((a, b) => a.startMs - b.startMs),
    [description],
  )

  /** 화면 '해설' 상자에 보일 문장: 지금 시각을 지난 마지막 문장 */
  const currentLine = useMemo<NarrationLine | null>(() => {
    let found: NarrationLine | null = null
    for (const l of lines) {
      if (l.startMs > state.currentMs) break
      found = l
    }
    return found
  }, [lines, state.currentMs])

  // 1 을 빼 둔다: 처음 시각(0초)에 딱 맞춰 시작하는 문장도 '아직 안 지난 문장'이어야 읽힌다
  const lastMsRef = useRef(state.currentMs - 1)
  /** 지금 걸려 있는 멈춤의 표. 멈춤이 겹치면 맨 나중 것만 영상을 다시 재생한다 */
  const holdRef = useRef<symbol | null>(null)
  /** 멈춤을 걸기 전에 재생 중이었는지 (겹친 멈춤이 이어받는다) */
  const heldPlayingRef = useRef(false)
  const playingRef = useRef(state.playing)
  const speakingImportance = useRef<number | null>(null)
  const coveredWarned = useRef(false)
  /**
   * 재생 중이던 영상을 해설(또는 답·요약)을 읽느라 잠깐 멈춰 둔 상태인지.
   * 사용자 입장에선 '재생 중'이다: 재생 버튼 글자·K·'멈춰' 판단에 state.playing 과 함께 쓴다
   */
  const [holding, setHolding] = useState(false)

  useEffect(() => {
    playingRef.current = state.playing
  }, [state.playing])

  /**
   * 영상을 멈추고 fn 을 끝낸 뒤 원래 재생 중이었으면 이어서 재생한다 (원칙 1장).
   * resume:false 면 이어서 재생하지 않고, 원래 재생 중이었는지만 돌려준다 (부르는 쪽이 안내를 마친 뒤 재생할 때)
   * queue:true 면 이미 멈추고 읽던 소리를 끊지 않고 그 뒤에 줄 세운다 (같은 시각에 겹친 해설 문장)
   */
  const holdWhile = useCallback(
    async (
      fn: () => Promise<unknown>,
      { resume = true, queue = false }: { resume?: boolean; queue?: boolean } = {},
    ) => {
      const joining = holdRef.current !== null
      const wasPlaying = joining ? heldPlayingRef.current : playingRef.current
      if (joining && !queue) narrator.stop()
      const token = Symbol('hold')
      holdRef.current = token
      heldPlayingRef.current = wasPlaying
      setHolding(wasPlaying)
      controls.pause()
      try {
        await fn()
      } finally {
        // 뒤에 온 멈춤이 이어받았으면 그쪽이 끝날 때 재생한다
        if (holdRef.current === token) {
          holdRef.current = null
          setHolding(false)
          if (wasPlaying && resume) controls.play()
        }
      }
      return wasPlaying
    },
    [controls, narrator],
  )

  /**
   * 사용자가 직접 재생·멈춤·이동했을 때: 우리가 걸어 둔 멈춤과 읽던 소리를 모두 거둔다.
   * 해설 때문에 멈춰 둔 상태였으면(resume) 영상을 이어서 재생한다 — 사용자는 재생 중이라고 알고 있다.
   * 돌려주는 값: 재생 중이던 영상을 해설 때문에 멈춰 둔 상태였는지 (= 사용자 입장에선 재생 중이었는지).
   * 원래 멈춰 있던 영상에서 다시 듣기 등을 하던 중이면 false 이고, 재생하지도 않는다
   */
  const interrupt = useCallback(
    (resume = true): boolean => {
      const wasHolding = holdRef.current !== null && heldPlayingRef.current
      holdRef.current = null
      setHolding(false)
      narrator.stop()
      speakingImportance.current = null
      if (wasHolding && resume) controls.play()
      return wasHolding
    },
    [narrator, controls],
  )

  /**
   * 문장 하나를 해설 방식대로 읽는다. 읽기 시작했으면 true, '대사만' 설정이라 읽지 않으면 false.
   * onTick 이 시각을 지날 때 부르고, 대본에서 문장을 골랐을 때(readLine)도 같은 길을 탄다.
   */
  const speakLine = useCallback(
    (line: NarrationLine): boolean => {
      if (settings.soundMix === 'DIALOGUE_ONLY') return false
      // 이 문장은 지금 읽으므로, 다음 tick 이 시각을 지났다고 또 읽지 않게 센 자리를 넘겨 둔다
      lastMsRef.current = Math.max(lastMsRef.current, line.startMs)
      const rate = settings.speechRate
      const needMs = (line.audioDurationMs ?? estimateSpeechMs(line.text)) / rate
      const gapMs = line.gapEndMs == null ? 0 : line.gapEndMs - line.startMs
      const mode = settings.narrationMode
      const mustPause = mode === 'PAUSE_AFTER' || (mode === 'AUTO' && needMs > gapMs + 300)
      const item = {
        text: line.text,
        audioUrl: line.audioUrl,
        rate,
        refreshUrl: () => refreshAudioUrl(line.lineId),
      }
      // 자동: 앞 문장을 아직 읽는 중이면(1초 간격·같은 시각 문장) 버리지 않고, 영상을 멈춘 채 이어서 읽는다
      if (mustPause || (mode === 'AUTO' && narrator.busy)) {
        void holdWhile(() => narrator.say(item), { queue: true })
        return true
      }
      if (narrator.busy) {
        if (line.importance <= (speakingImportance.current ?? 0)) return true
        narrator.stop()
      }
      speakingImportance.current = line.importance
      void narrator.say(item).finally(() => {
        speakingImportance.current = null
      })
      return true
    },
    [
      settings.soundMix,
      settings.speechRate,
      settings.narrationMode,
      holdWhile,
      narrator,
      refreshAudioUrl,
    ],
  )

  const readScreenText = useEffectEvent((t: ScreenText) => {
    if (settings.soundMix === 'DIALOGUE_ONLY') return
    const text = screenTextToRead(t, settings.detailLevel, settings.subtitleReading)
    if (!text) return
    void narrator.say({ text, rate: settings.speechRate, skipIfBusy: true })
  })

  const onTick = useEffectEvent((now: number) => {
    const prev = lastMsRef.current
    // 맨 처음 0초에 멈춰 있는 동안은 올리지 않는다 (올리면 0초 문장이 지난 문장이 돼 재생해도 읽히지 않는다)
    if (now > 0 || prev >= 0 || playingRef.current) lastMsRef.current = now
    if (!description || !playingRef.current) return
    if (Math.abs(now - prev) > JUMP_MS) {
      // 재생바로 옮겼다. 읽던 소리는 끊고 여기서부터 새로 센다
      interrupt()
      coveredWarned.current = false
      return
    }
    if (
      description.coveredUntilMs != null &&
      prev < description.coveredUntilMs &&
      now >= description.coveredUntilMs &&
      !coveredWarned.current
    ) {
      coveredWarned.current = true
      announce('여기부터는 해설이 없어요. 영상 소리만 나와요.')
    }
    for (const l of lines) {
      if (l.startMs <= prev) continue
      if (l.startMs > now) break
      speakLine(l)
    }
    for (const t of screenTexts) {
      if (t.startMs <= prev) continue
      if (t.startMs > now) break
      readScreenText(t)
    }
  })

  useEffect(() => {
    onTick(state.currentMs)
  }, [state.currentMs])

  /**
   * "이 시각으로 옮긴다"고 미리 알린다 — controls.seek 바로 뒤에 부른다.
   * 그러면 다음 tick 이 큰 이동으로 보고 읽던 소리를 끊지 않고(옮긴 뒤 바로 읽기 시작한 문장이 살아남는다),
   * 옮긴 지점에서 정확히 시작하는 문장부터 읽는다. 끊는 것은 호출한 쪽이 interrupt 로 먼저 한다.
   */
  const markSeek = useCallback((ms: number) => {
    lastMsRef.current = ms - 1
    coveredWarned.current = false
  }, [])

  // 영상이 끝나면 읽던 소리도 멈춘다
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 끝난 순간 한 번 멈춤 표시(holding)를 거둔다. 영상 상태(외부)에 맞추는 것
    if (state.ended) interrupt(false)
  }, [state.ended, interrupt])

  /**
   * 지금 화면 글자의 긴 글(fullText) 읽기 — '자세히' (READ_DETAIL).
   * resume:false 면 읽은 뒤 이어서 재생하지 않는다 (챗봇 명령으로 읽을 때).
   * hold: 멈추고 읽는 방법 (기본 holdWhile. 시청 화면은 Esc 로 멈출 수 있게 감싼 것을 넘긴다)
   */
  const readDetail = useCallback(
    ({
      resume = true,
      hold = holdWhile,
    }: {
      resume?: boolean
      hold?: (fn: () => Promise<unknown>, opts?: { resume?: boolean }) => Promise<unknown>
    } = {}) => {
      const t = screenTexts.find(
        (s) => s.startMs <= state.currentMs && state.currentMs < s.endMs && s.headline,
      )
      if (!t) return false
      void hold(() => narrator.say({ text: t.fullText, rate: settings.speechRate }), { resume })
      return true
    },
    [screenTexts, state.currentMs, holdWhile, narrator, settings.speechRate],
  )

  return {
    lines,
    currentLine,
    /** 재생 중이던 영상을 해설·답 때문에 잠깐 멈춰 둔 상태 (사용자 입장에선 재생 중) */
    holding,
    /** holding 과 같지만 지금 이 순간의 값 (렌더를 기다리지 않는다) */
    isHoldingNow: () => holdRef.current !== null && heldPlayingRef.current,
    holdWhile,
    interrupt,
    readDetail,
    markSeek,
    /** 사용자가 고른 문장을 지금 읽는다 (대본 탭). 해설 방식을 따르고, 다음 tick 이 또 읽지 않는다. '대사만'이면 false */
    readLine: speakLine,
  }
}
