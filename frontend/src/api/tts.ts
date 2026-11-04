import { request } from './client'

export interface TtsResult {
  /** 만들지 못했으면 null → 브라우저 음성으로 읽는다 */
  audioUrl: string | null
  durationMs: number | null
  latencyMs: number
}

/** 안내 목소리(H200 Supertonic). 화면에서 소리로 읽는 안내·대체 음성 (POST /tts) */
export const ttsApi = {
  synthesize: (text: string, voice?: string, signal?: AbortSignal) =>
    request<TtsResult>({
      method: 'POST',
      url: '/tts',
      data: { text, ...(voice ? { voice } : {}) },
      signal,
    }),
}
