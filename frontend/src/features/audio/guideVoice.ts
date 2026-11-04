import { tokenStore } from '@/api/token'
import { ttsApi } from '@/api/tts'

/**
 * 안내 목소리 주소. 음성 파일이 없는 문장(안내·장면 설명·만들기 전의 상세도 3 등)을 브라우저 음성 대신
 * H200 Supertonic으로 읽는다(목소리 나누기: 해설은 Kore, 그 밖의 화면 낭독은 Supertonic).
 * 못 만들면 null → 부른 쪽이 브라우저 음성으로 읽는다. 같은 문장은 화면에서도 주소를 잠깐 기억한다(서버도 저장본을 다시 씀).
 *
 * 기다리는 시간을 짧게 둔다: H200이 느리거나 꺼져 있으면 BE는 최대 7초(+연결 2초) 뒤에야 null을 주는데,
 * 그동안 소리가 나지 않으면 안 된다. WAIT_MS 안에 오지 않으면 브라우저 음성으로 읽고,
 * 그 뒤 PAUSE_MS 동안은 부르지 않아 문장마다 같은 지연이 반복되지 않게 한다.
 */
const MAX_CHARS = 500 // BE TtsRequest 한도
const KEEP_MS = 10 * 60 * 1000 // 주소를 기억하는 시간 (presigned 주소는 6시간 유효)
const MAX_REMEMBERED = 200 // 기억하는 문장 수. 넘으면 오래된 것부터 지운다
export const WAIT_MS = 1_500 // Supertonic 한 문장 약 0.04초 + 왕복. 이보다 늦으면 서버 쪽 문제로 본다
export const PAUSE_MS = 60 * 1000

const remembered = new Map<string, { url: string; at: number }>()
let pausedUntil = 0

export async function guideAudioUrl(text: string): Promise<string | null> {
  const t = text.trim()
  if (!t || t.length > MAX_CHARS) return null
  // /tts는 로그인이 필요하다. 로그인 전에 부르면 401 처리(세션 만료 안내)가 일어나므로 브라우저 음성으로 둔다
  if (!tokenStore.get()) return null
  const hit = remembered.get(t)
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.url
  if (Date.now() < pausedUntil) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WAIT_MS)
  try {
    const { audioUrl } = await ttsApi.synthesize(t, undefined, controller.signal)
    if (audioUrl) {
      remembered.delete(t) // 다시 넣어 가장 최근 것으로
      remembered.set(t, { url: audioUrl, at: Date.now() })
      if (remembered.size > MAX_REMEMBERED) remembered.delete(remembered.keys().next().value!)
    }
    return audioUrl
  } catch {
    // 시간 초과·서버 오류 → 브라우저 음성. 잠시 부르지 않는다
    pausedUntil = Date.now() + PAUSE_MS
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 시험용: 기억한 주소와 쉬는 상태 비우기 */
export function forgetGuideAudio() {
  remembered.clear()
  pausedUntil = 0
}
