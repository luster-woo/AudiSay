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

/**
 * 열린 모달 대화상자를 안내 영역의 자리로 등록한다(창마다 고유한 id). 돌려받은 함수로 등록을 푼다.
 * showModal() 은 창 바깥을 inert 로 막아 바깥 aria-live 영역을 낭독기가 읽지 않는다.
 * 그래서 창이 열려 있는 동안에는 맨 위 창 안의 안내 영역(LiveRegions)에 글자를 쓴다.
 *
 * 안내 영역은 옮기거나 새로 만들지 않는다 — 본문에 하나, 창마다 하나가 처음부터 있고 글자만 바뀐다.
 * 크롬은 새로 생긴(또는 막 나타난) 영역의 글자를 "처음부터 있던 내용"으로 보고 읽지 않기 때문이다
 * (2026-11-09 NVDA 실측: 창을 열 때 영역을 끼워 넣으면 안 읽히고, 미리 있던 영역에 쓰면 읽힌다).
 * Provider 밖(부품 단독 테스트)에서는 아무 일도 하지 않는다.
 */
export type RegisterLiveHost = (hostId: string) => () => void
export const LiveHostContext = createContext<RegisterLiveHost>(() => () => {})

/** 안내 영역이 보여 줄 글자와 지금 글자를 써야 할 자리. LiveRegions 가 읽는다 */
export interface LiveRegionsValue {
  polite: string
  assertive: string
  /** 글자를 쓸 자리: 맨 위 창의 hostId, 창이 없으면 null(본문) */
  activeHostId: string | null
}
export const LiveRegionsContext = createContext<LiveRegionsValue>({
  polite: '',
  assertive: '',
  activeHostId: null,
})

export function useAnnouncer() {
  const ctx = useContext(AnnouncerContext)
  if (!ctx) throw new Error('useAnnouncer 는 AnnouncerProvider 안에서만 쓸 수 있어요')
  return ctx
}
