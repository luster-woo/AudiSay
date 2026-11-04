import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const synthesize = vi.fn()
vi.mock('@/api/tts', () => ({ ttsApi: { synthesize: (...a: unknown[]) => synthesize(...a) } }))

import { tokenStore } from '@/api/token'
import { forgetGuideAudio, guideAudioUrl, PAUSE_MS, WAIT_MS } from './guideVoice'

/** 응답이 오지 않다가 취소(abort)되면 실패하는 가짜 요청 */
const hang = (_t: string, _v: unknown, signal: AbortSignal) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))

beforeEach(() => {
  vi.useFakeTimers()
  synthesize.mockReset()
  forgetGuideAudio()
  tokenStore.set('access-token')
})
afterEach(() => {
  vi.useRealTimers()
  tokenStore.clear()
})

test('정해진 시간 안에 오지 않으면 기다리지 않고 null (브라우저 음성으로)', async () => {
  synthesize.mockImplementation(hang)
  const result = guideAudioUrl('지금 장면이에요.')
  await vi.advanceTimersByTimeAsync(WAIT_MS)
  await expect(result).resolves.toBeNull()
})

test('실패한 뒤 잠시 동안은 부르지 않고, 지나면 다시 부른다', async () => {
  synthesize.mockImplementation(hang)
  const first = guideAudioUrl('첫 문장')
  await vi.advanceTimersByTimeAsync(WAIT_MS)
  await first
  expect(synthesize).toHaveBeenCalledTimes(1)

  await expect(guideAudioUrl('둘째 문장')).resolves.toBeNull()
  expect(synthesize).toHaveBeenCalledTimes(1)

  await vi.advanceTimersByTimeAsync(PAUSE_MS)
  synthesize.mockResolvedValue({ audioUrl: 'https://s3/tts/3.mp3', durationMs: 900, latencyMs: 40 })
  await expect(guideAudioUrl('셋째 문장')).resolves.toBe('https://s3/tts/3.mp3')
  expect(synthesize).toHaveBeenCalledTimes(2)
})

test('서버가 null 을 주면(읽을 글자 없음 등) 쉬지 않고 다음 문장은 다시 부른다', async () => {
  synthesize.mockResolvedValue({ audioUrl: null, durationMs: null, latencyMs: 5 })
  await expect(guideAudioUrl('▶')).resolves.toBeNull()
  synthesize.mockResolvedValue({ audioUrl: 'https://s3/tts/1.mp3', durationMs: 900, latencyMs: 40 })
  await expect(guideAudioUrl('안녕하세요')).resolves.toBe('https://s3/tts/1.mp3')
})
