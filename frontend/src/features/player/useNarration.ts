import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from 'react'
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

  const lastMsRef = useRef(state.currentMs)
  const holdRef = useRef(false)
  const playingRef = useRef(state.playing)
  const speakingImportance = useRef<number | null>(null)
  const coveredWarned = useRef(false)

  useEffect(() => {
    playingRef.current = state.playing
  }, [state.playing])

  /** 영상을 멈추고 fn 을 끝낸 뒤 원래 재생 중이었으면 이어서 재생한다 (원칙 1장) */
  const holdWhile = useCallback(
    async (fn: () => Promise<unknown>) => {
      const wasPlaying = playingRef.current
      if (holdRef.current) narrator.stop()
      holdRef.current = true
      controls.pause()
      try {
        await fn()
      } finally {
        if (holdRef.current) {
          holdRef.current = false
          if (wasPlaying) controls.play()
        }
      }
    },
    [controls, narrator],
  )

  /**
   * 사용자가 직접 재생·멈춤·이동했을 때: 우리가 걸어 둔 멈춤과 읽던 소리를 모두 거둔다.
   * 해설 때문에 멈춰 둔 상태였으면(resume) 영상을 이어서 재생한다 — 사용자는 재생 중이라고 알고 있다.
   * 돌려주는 값: 해설 때문에 멈춰 둔 상태였는지 (= 사용자 입장에선 재생 중이었는지)
   */
  const interrupt = useCallback(
    (resume = true): boolean => {
      const wasHolding = holdRef.current
      holdRef.current = false
      narrator.stop()
      speakingImportance.current = null
      if (wasHolding && resume) controls.play()
      return wasHolding
    },
    [narrator, controls],
  )

  const speakLine = useEffectEvent((line: NarrationLine) => {
    if (settings.soundMix === 'DIALOGUE_ONLY') return
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
    if (mustPause) {
      void holdWhile(() => narrator.say(item))
      return
    }
    if (narrator.busy) {
      if (line.importance <= (speakingImportance.current ?? 0)) return
      narrator.stop()
    }
    speakingImportance.current = line.importance
    void narrator.say(item).finally(() => {
      speakingImportance.current = null
    })
  })

  const readScreenText = useEffectEvent((t: ScreenText) => {
    if (settings.soundMix === 'DIALOGUE_ONLY') return
    const text = screenTextToRead(t, settings.detailLevel, settings.subtitleReading)
    if (!text) return
    void narrator.say({ text, rate: settings.speechRate, skipIfBusy: true })
  })

  const onTick = useEffectEvent((now: number) => {
    const prev = lastMsRef.current
    lastMsRef.current = now
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

  // 영상이 끝나면 읽던 소리도 멈춘다
  useEffect(() => {
    if (state.ended) interrupt(false)
  }, [state.ended, interrupt])

  /** 지금 화면 글자의 긴 글(fullText) 읽기 — '자세히' (READ_DETAIL) */
  const readDetail = useCallback(() => {
    const t = screenTexts.find(
      (s) => s.startMs <= state.currentMs && state.currentMs < s.endMs && s.headline,
    )
    if (!t) return false
    void holdWhile(() => narrator.say({ text: t.fullText, rate: settings.speechRate }))
    return true
  }, [screenTexts, state.currentMs, holdWhile, narrator, settings.speechRate])

  return { lines, currentLine, holdWhile, interrupt, readDetail }
}
