import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AnnouncerContext,
  type AnnounceOptions,
  type AnnouncerValue,
  type Politeness,
} from './context'

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [lastMessage, setLastMessage] = useState('')
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
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
