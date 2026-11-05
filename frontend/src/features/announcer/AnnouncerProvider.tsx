import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AnnouncerContext,
  LiveHostContext,
  type RegisterLiveHost,
  type AnnounceOptions,
  type AnnouncerValue,
  type Politeness,
} from './context'

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
  const lastRef = useRef<{ text: string; politeness: Politeness }>({
    text: '',
    politeness: 'polite',
  })

  const push = useCallback((text: string, politeness: Politeness) => {
    const set = politeness === 'assertive' ? setAssertive : setPolite
    // 같은 문자열은 낭독기가 다시 읽지 않으므로 비웠다가 다음 프레임에 넣는다
    set('')
    requestAnimationFrame(() => set(text))
  }, [])

  const announce = useCallback(
    (text: string, opts: AnnounceOptions = {}) => {
      const politeness = opts.politeness ?? 'polite'
      lastRef.current = { text, politeness }
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
