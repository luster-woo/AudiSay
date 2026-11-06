import { createContext, useContext } from 'react'

export type Politeness = 'polite' | 'assertive'
export interface AnnounceOptions {
  politeness?: Politeness
}

/**
 * 우리 음성 채널 (시청 화면의 Narrator: 해설·답변·요약 음성).
 * 낭독기 안내와 겹치지 않게 Announcer 와 순서를 맞춘다 (bindVoice)
 */
export interface VoiceChannel {
  /** 소리를 내는 중이거나 낼 차례를 기다리는 중 */
  readonly busy: boolean
  /** 지금 소리와 줄을 모두 멈춘다 */
  stop: () => void
  /** 말하기 시작·끝 알림을 건다. 해제 함수를 돌려준다 */
  onBusyChange: (listener: (busy: boolean) => void) => () => void
  /** 다음 소리를 내기 전에 기다릴 시간(ms)을 묻는 함수를 건다. 낭독기가 안내를 읽는 중이면 그만큼 */
  setQuietWait: (fn: (() => number) | null) => void
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
  /**
   * 우리 음성 채널을 잇는다. 그 채널이 말하는 동안 polite 안내는 미뤘다가 끝나면 읽고,
   * assertive 안내는 그 소리를 끊고 바로 읽는다. 해제 함수를 돌려준다
   */
  bindVoice: (voice: VoiceChannel) => () => void
}

/**
 * 낭독기가 안내를 다 읽는 데 걸릴 시간 어림. 낭독기가 언제 끝나는지 웹에서는 알 수 없어서
 * 글자 수(공백 제외) × 130ms + 300ms, 최대 10초
 */
export const estimateReaderMs = (text: string) =>
  Math.min(10_000, 300 + text.replace(/\s/g, '').length * 130)

export const AnnouncerContext = createContext<AnnouncerValue | null>(null)

export function useAnnouncer() {
  const ctx = useContext(AnnouncerContext)
  if (!ctx) throw new Error('useAnnouncer 는 AnnouncerProvider 안에서만 쓸 수 있어요')
  return ctx
}
