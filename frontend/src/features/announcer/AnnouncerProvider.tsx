import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AnnouncerContext,
  estimateReaderMs,
  LiveHostContext,
  type RegisterLiveHost,
  type AnnounceOptions,
  type AnnouncerValue,
  type Politeness,
  type VoiceChannel,
} from './context'

/** 우리 음성이 문장 사이에 잠깐 쉬는 동안(답변 문장 사이 등)에는 미룬 안내를 내보내지 않는다 */
const FLUSH_GRACE_MS = 300
/** 안내 영역 자리가 바뀌기 이만큼 전까지 보낸 안내는 다시 읽힌다 */
const REPLAY_WINDOW_MS = 1000
const REPLAY_DELAY_MS = 100

/**
 * 낭독기 안내(aria-live)와 우리 음성(bindVoice 로 이은 Narrator)을 겹치지 않게 한다.
 * - 영상 내용(해설·답변·요약)은 우리 음성, 조작 결과 같은 짧은 안내는 낭독기가 읽는다
 * - 우리 음성이 말하는 동안 polite 안내는 줄에 두었다가 끝나면 한 번에 읽는다
 * - assertive(오류)는 미루지 않고 우리 음성을 끊은 뒤 바로 읽는다
 * - 안내를 보낸 직후에는 우리 음성이 그 안내 길이(어림)만큼 기다렸다가 시작한다
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [lastMessage, setLastMessage] = useState('')
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  // 열린 모달 창들 (나중에 연 것이 맨 뒤). 맨 위 창 안에 안내 영역을 그린다
  const [hosts, setHosts] = useState<HTMLElement[]>([])
  const registerLiveHost = useCallback<RegisterLiveHost>((el) => {
    setHosts((h) => [...h.filter((x) => x !== el), el])
    return () => setHosts((h) => h.filter((x) => x !== el))
  }, [])
  const mutedRef = useRef(false)
  const lastAtRef = useRef(0)
  const pendingRef = useRef(0)
  const lastRef = useRef<{ text: string; politeness: Politeness }>({
    text: '',
    politeness: 'polite',
  })
  const voiceRef = useRef<VoiceChannel | null>(null)
  /** 우리 음성이 말하는 동안 미뤄 둔 polite 안내 */
  const queueRef = useRef<string[]>([])
  const flushTimerRef = useRef<number | null>(null)
  /** 낭독기가 마지막 안내를 다 읽을 것으로 어림한 시각 */
  const quietUntilRef = useRef(0)

  const push = useCallback((text: string, politeness: Politeness) => {
    quietUntilRef.current = Math.max(quietUntilRef.current, Date.now() + estimateReaderMs(text))
    const set = politeness === 'assertive' ? setAssertive : setPolite
    // 같은 문자열은 낭독기가 다시 읽지 않으므로 비웠다가 다음 프레임에 넣는다
    set('')
    pendingRef.current = requestAnimationFrame(() => set(text))
  }, [])

  const cancelFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }, [])

  const flush = useCallback(() => {
    cancelFlush()
    if (voiceRef.current?.busy) return
    const texts = queueRef.current
    queueRef.current = []
    if (texts.length > 0 && !mutedRef.current) push(texts.join(' '), 'polite')
  }, [cancelFlush, push])

  const scheduleFlush = useCallback(() => {
    cancelFlush()
    flushTimerRef.current = window.setTimeout(flush, FLUSH_GRACE_MS)
  }, [cancelFlush, flush])

  /** 우리 음성과 겹치지 않게 낭독기로 보낸다 */
  const deliver = useCallback(
    (text: string, politeness: Politeness) => {
      const voice = voiceRef.current
      if (politeness === 'assertive') {
        if (voice?.busy) voice.stop()
        push(text, 'assertive')
        return
      }
      const queue = queueRef.current
      if (voice?.busy || queue.length > 0) {
        if (queue[queue.length - 1] !== text) queue.push(text)
        if (!voice?.busy) scheduleFlush()
        return
      }
      push(text, 'polite')
    },
    [push, scheduleFlush],
  )

  const announce = useCallback(
    (text: string, opts: AnnounceOptions = {}) => {
      const politeness = opts.politeness ?? 'polite'
      lastRef.current = { text, politeness }
      lastAtRef.current = Date.now()
      setLastMessage(text)
      if (mutedRef.current) return
      deliver(text, politeness)
    },
    [deliver],
  )

  const repeat = useCallback(() => {
    const { text, politeness } = lastRef.current
    if (text) deliver(text, politeness)
  }, [deliver])

  const setMuted = useCallback((m: boolean) => {
    mutedRef.current = m
  }, [])

  const onVoiceBusy = useCallback(
    (busy: boolean) => {
      if (busy) cancelFlush()
      else if (queueRef.current.length > 0) scheduleFlush()
    },
    [cancelFlush, scheduleFlush],
  )

  const bindVoice = useCallback(
    (voice: VoiceChannel) => {
      voiceRef.current = voice
      voice.setQuietWait(() => Math.max(0, quietUntilRef.current - Date.now()))
      const off = voice.onBusyChange(onVoiceBusy)
      return () => {
        off()
        voice.setQuietWait(null)
        if (voiceRef.current === voice) voiceRef.current = null
        flush()
      }
    },
    [onVoiceBusy, flush],
  )

  useEffect(() => cancelFlush, [cancelFlush])

  const value = useMemo<AnnouncerValue>(
    () => ({ announce, repeat, lastMessage, setMuted, bindVoice }),
    [announce, repeat, lastMessage, setMuted, bindVoice],
  )

  // 화면에는 안 보이고 낭독기만 읽는 영역. 보이는 띠는 AppLayout 이 lastMessage 로 그린다
  const regions = (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {polite}
      </div>
      <div aria-live="assertive" aria-atomic="true" role="alert" className="sr-only">
        {assertive}
      </div>
    </>
  )
  const host = hosts.at(-1)

  /**
   * 창이 열리거나 닫혀 안내 영역이 새 자리에 다시 그려지면, 그 직전에 넣은 문구는 '처음부터 있던 내용'이 되어
   * 낭독기가 읽지 않는다 (예: 창을 열며 "영상을 멈췄어요", 닫으며 "이어서 재생해요"). 방금 보낸 안내를 다시 넣는다
   */
  const prevHostRef = useRef(host)
  useEffect(() => {
    if (prevHostRef.current === host) return
    prevHostRef.current = host
    if (mutedRef.current || Date.now() - lastAtRef.current > REPLAY_WINDOW_MS) return
    // 우리 음성 때문에 미뤄 둔 안내는 아직 읽지 않았다. 나중에 새 영역에서 한 번만 읽힌다
    if (queueRef.current.length > 0) return
    const { text, politeness } = lastRef.current
    if (!text) return
    quietUntilRef.current = Math.max(quietUntilRef.current, Date.now() + estimateReaderMs(text))
    const set = politeness === 'assertive' ? setAssertive : setPolite
    // 아직 넣지 않은 안내가 있으면 거두고, 새 영역에 한 번만 넣는다 (두 번 읽히지 않게)
    cancelAnimationFrame(pendingRef.current)
    set('')
    // 새 영역이 접근성 트리에 올라간 뒤에 바꿔야 변화로 읽힌다
    const id = setTimeout(() => set(text), REPLAY_DELAY_MS)
    return () => clearTimeout(id)
  }, [host])

  return (
    <AnnouncerContext.Provider value={value}>
      <LiveHostContext.Provider value={registerLiveHost}>
        {children}
        {/* 모달 창이 열려 있으면 바깥이 inert 라 읽히지 않으므로 창 안에 그린다 */}
        {host ? createPortal(regions, host) : regions}
      </LiveHostContext.Provider>
    </AnnouncerContext.Provider>
  )
}
