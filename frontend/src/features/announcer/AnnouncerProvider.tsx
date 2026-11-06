import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AnnouncerContext,
  estimateReaderMs,
  type AnnounceOptions,
  type AnnouncerValue,
  type Politeness,
  type VoiceChannel,
} from './context'

/** 우리 음성이 문장 사이에 잠깐 쉬는 동안(답변 문장 사이 등)에는 미룬 안내를 내보내지 않는다 */
const FLUSH_GRACE_MS = 300

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
  const mutedRef = useRef(false)
  const lastRef = useRef<{ text: string; politeness: Politeness }>({
    text: '',
    politeness: 'polite',
  })
  const voiceRef = useRef<VoiceChannel | null>(null)
  const pendingRef = useRef<string[]>([])
  const flushTimerRef = useRef<number | null>(null)
  /** 낭독기가 마지막 안내를 다 읽을 것으로 어림한 시각 */
  const quietUntilRef = useRef(0)

  const push = useCallback((text: string, politeness: Politeness) => {
    quietUntilRef.current = Math.max(quietUntilRef.current, Date.now() + estimateReaderMs(text))
    const set = politeness === 'assertive' ? setAssertive : setPolite
    // 같은 문자열은 낭독기가 다시 읽지 않으므로 비웠다가 다음 프레임에 넣는다
    set('')
    requestAnimationFrame(() => set(text))
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
    const texts = pendingRef.current
    pendingRef.current = []
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
      const pending = pendingRef.current
      if (voice?.busy || pending.length > 0) {
        if (pending[pending.length - 1] !== text) pending.push(text)
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
      else if (pendingRef.current.length > 0) scheduleFlush()
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

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      {/* 화면에는 안 보이고 낭독기만 읽는 영역. 보이는 띠는 AppLayout 이 lastMessage 로 그린다 */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {polite}
      </div>
      <div aria-live="assertive" aria-atomic="true" role="alert" className="sr-only">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  )
}
