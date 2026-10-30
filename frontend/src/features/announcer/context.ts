import { createContext, useContext } from 'react'

export type Politeness = 'polite' | 'assertive'
export interface AnnounceOptions {
  politeness?: Politeness
}
export interface AnnouncerValue {
  /** 낭독기에 읽어 주고, 보이는 안내 띠 문구도 바꾼다 */
  announce: (text: string, opts?: AnnounceOptions) => void
  /** 마지막 안내를 다시 읽는다 (Alt+Shift+R) */
  repeat: () => void
  /** 안내 띠에 보여 줄 마지막 문구 (AppLayout 이 렌더) */
  lastMessage: string
  /** TTS 재생 중처럼 낭독을 잠시 막아야 할 때 */
  setMuted: (muted: boolean) => void
}

export const AnnouncerContext = createContext<AnnouncerValue | null>(null)

export function useAnnouncer() {
  const ctx = useContext(AnnouncerContext)
  if (!ctx) throw new Error('useAnnouncer 는 AnnouncerProvider 안에서만 쓸 수 있어요')
  return ctx
}
