import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AnnouncerContext,
  LiveHostContext,
  type RegisterLiveHost,
  type AnnounceOptions,
  type AnnouncerValue,
  type Politeness,
} from './context'

/** 안내 영역 자리가 바뀌기 이만큼 전까지 보낸 안내는 다시 읽힌다 */
const REPLAY_WINDOW_MS = 1000
const REPLAY_DELAY_MS = 100

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

  const push = useCallback((text: string, politeness: Politeness) => {
    const set = politeness === 'assertive' ? setAssertive : setPolite
    // 같은 문자열은 낭독기가 다시 읽지 않으므로 비웠다가 다음 프레임에 넣는다
    set('')
    pendingRef.current = requestAnimationFrame(() => set(text))
  }, [])

  const announce = useCallback(
    (text: string, opts: AnnounceOptions = {}) => {
      const politeness = opts.politeness ?? 'polite'
      lastRef.current = { text, politeness }
      lastAtRef.current = Date.now()
      setLastMessage(text)
      if (mutedRef.current) return
      push(text, politeness)
    },
    [push],
  )

  const repeat = useCallback(() => {
    const { text, politeness } = lastRef.current
    if (text) push(text, politeness)
  }, [push])

  const setMuted = useCallback((m: boolean) => {
    mutedRef.current = m
  }, [])

  const value = useMemo<AnnouncerValue>(
    () => ({ announce, repeat, lastMessage, setMuted }),
    [announce, repeat, lastMessage, setMuted],
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
    const { text, politeness } = lastRef.current
    if (!text) return
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
