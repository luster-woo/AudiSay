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

/**
 * 열린 모달 대화상자를 안내 영역의 자리로 등록한다. 돌려받은 함수로 등록을 푼다.
 * showModal() 은 창 바깥을 inert 로 막아 바깥 aria-live 영역을 낭독기가 읽지 않는다.
 * 그래서 창이 열려 있는 동안에는 안내 영역을 맨 위 창 안으로 옮겨 그린다.
 * Provider 밖(부품 단독 테스트)에서는 아무 일도 하지 않는다.
 */
export type RegisterLiveHost = (el: HTMLElement) => () => void
export const LiveHostContext = createContext<RegisterLiveHost>(() => () => {})

export function useAnnouncer() {
  const ctx = useContext(AnnouncerContext)
  if (!ctx) throw new Error('useAnnouncer 는 AnnouncerProvider 안에서만 쓸 수 있어요')
  return ctx
}
