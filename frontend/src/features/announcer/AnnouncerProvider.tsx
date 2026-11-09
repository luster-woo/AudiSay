import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AnnouncerContext,
  estimateReaderMs,
  LiveHostContext,
  LiveRegionsContext,
  type LiveRegionsValue,
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
  // 열린 모달 창들의 id (나중에 연 것이 맨 뒤). 맨 위 창 안의 안내 영역에 글자를 쓴다
  const [hosts, setHosts] = useState<string[]>([])
  const registerLiveHost = useCallback<RegisterLiveHost>((id) => {
    setHosts((h) => [...h.filter((x) => x !== id), id])
    return () => setHosts((h) => h.filter((x) => x !== id))
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

  const host = hosts.at(-1) ?? null

  /**
   * 창이 열리거나 닫혀 글자를 쓸 자리가 바뀌면, 그 직전에 보낸 안내는 이제 inert 가 된(또는 닫힌) 자리에 남아
   * 낭독기가 읽지 못한다 (예: 창을 열며 "영상을 멈췄어요", 닫으며 "이어서 재생해요"). 새 자리에 다시 쓴다.
   * 새 자리의 영역은 이미 DOM 에 있으므로(창 markup 에 포함) 글자 변화로 읽힌다 — 단, 창이 막 나타난 직후라
   * 접근성 트리에 올라갈 시간을 조금 준다
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
    // 새 자리(창 안 영역)가 접근성 트리에 올라간 뒤에 바꿔야 변화로 읽힌다
    const id = setTimeout(() => set(text), REPLAY_DELAY_MS)
    return () => clearTimeout(id)
  }, [host])

  const live = useMemo<LiveRegionsValue>(
    () => ({ polite, assertive, activeHostId: host }),
    [polite, assertive, host],
  )

  return (
    <AnnouncerContext.Provider value={value}>
      <LiveHostContext.Provider value={registerLiveHost}>
        <LiveRegionsContext.Provider value={live}>
          {children}
          {/* 본문의 안내 영역. 늘 여기 있고, 모달 창이 열려 있는 동안은 비워 둔다(바깥은 inert 라 읽히지 않는다) */}
          <LiveRegions hostId={null} />
        </LiveRegionsContext.Provider>
      </LiveHostContext.Provider>
    </AnnouncerContext.Provider>
  )
}

/**
 * 화면에는 안 보이고 낭독기만 읽는 안내 영역 한 벌 (polite + assertive).
 * 본문에 하나(hostId=null), 모달 창마다 하나(Dialog 가 자기 id 로 둔다). 처음 그릴 때부터 DOM 에 있고,
 * 지금 글자를 쓸 자리(activeHostId)와 같은 것만 글자를 보인다. Provider 밖에서는 빈 영역이다
 */
export function LiveRegions({ hostId }: { hostId: string | null }) {
  const { polite, assertive, activeHostId } = useContext(LiveRegionsContext)
  const active = activeHostId === hostId
  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {active ? polite : ''}
      </div>
      <div aria-live="assertive" aria-atomic="true" role="alert" className="sr-only">
        {active ? assertive : ''}
      </div>
    </>
  )
}
