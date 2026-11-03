import { tokenStore } from '@/api/token'
import { ttsApi } from '@/api/tts'

/**
 * 안내 목소리 주소. 음성 파일이 없는 문장(안내·장면 설명·만들기 전의 상세도 3 등)을 브라우저 음성 대신
 * H200 Supertonic으로 읽는다(목소리 나누기: 해설은 Kore, 그 밖의 화면 낭독은 Supertonic).
 * 못 만들면 null → 부른 쪽이 브라우저 음성으로 읽는다. 같은 문장은 화면에서도 주소를 잠깐 기억한다(서버도 저장본을 다시 씀).
 */
const MAX_CHARS = 500 // BE TtsRequest 한도
const KEEP_MS = 10 * 60 * 1000 // presigned 주소가 살아 있는 동안만 다시 쓴다
const remembered = new Map<string, { url: string; at: number }>()

export async function guideAudioUrl(text: string): Promise<string | null> {
  const t = text.trim()
  if (!t || t.length > MAX_CHARS) return null
  // /tts는 로그인이 필요하다. 로그인 전에 부르면 401 처리(세션 만료 안내)가 일어나므로 브라우저 음성으로 둔다
  if (!tokenStore.get()) return null
  const hit = remembered.get(t)
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.url
  try {
    const { audioUrl } = await ttsApi.synthesize(t)
    if (audioUrl) remembered.set(t, { url: audioUrl, at: Date.now() })
    return audioUrl
  } catch {
    return null // 서버 오류·로그인 전 등 → 브라우저 음성
  }
}

/** 시험용: 기억한 주소 비우기 */
export function forgetGuideAudio() {
  remembered.clear()
}
