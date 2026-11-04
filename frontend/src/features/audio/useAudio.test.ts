import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const synthesize = vi.fn()
vi.mock('@/api/tts', () => ({ ttsApi: { synthesize: (...a: unknown[]) => synthesize(...a) } }))

import { tokenStore } from '@/api/token'
import { forgetGuideAudio } from './guideVoice'
import { useAudio } from './useAudio'

/** 가짜 Audio: 재생을 시작하면 기록하고, 0.5초 뒤 끝난다. 멈추면 끝나지 않는다 */
const started: string[] = []
const finished: string[] = []
class FakeAudio {
  playbackRate = 1
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  src: string
  constructor(src: string) {
    this.src = src
  }
  play() {
    started.push(this.src)
    this.timer = setTimeout(() => {
      finished.push(this.src)
      this.onended?.()
    }, 500)
    return Promise.resolve()
  }
  pause() {
    clearTimeout(this.timer)
  }
}

/** 문장마다 안내 목소리 응답이 오는 시간을 다르게 준다 */
let delayOf: Record<string, number> = {}
beforeEach(() => {
  delayOf = {}
  vi.useFakeTimers()
  started.length = 0
  finished.length = 0
  synthesize.mockReset()
  synthesize.mockImplementation(
    (text: string) =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ audioUrl: `guide:${text}`, durationMs: 500, latencyMs: 1 }),
          delayOf[text] ?? 10,
        ),
      ),
  )
  forgetGuideAudio()
  tokenStore.set('access-token')
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('speechSynthesis', { speak: () => {}, cancel: () => {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  tokenStore.clear()
})

test('speak 를 연달아 부르면 응답이 늦게 와도 부른 순서대로, 앞 문장을 끊지 않고 읽는다', async () => {
  delayOf['첫 장면'] = 300 // 첫 문장의 응답이 더 늦게 온다
  delayOf['둘째 장면'] = 10
  const { result } = renderHook(() => useAudio())
  const ends: string[] = []
  act(() => {
    result.current.speak('첫 장면', 1, () => ends.push('첫 장면'))
    result.current.speak('둘째 장면', 1, () => ends.push('둘째 장면'))
  })
  await act(() => vi.advanceTimersByTimeAsync(2_000))
  expect(started).toEqual(['guide:첫 장면', 'guide:둘째 장면'])
  expect(finished).toEqual(['guide:첫 장면', 'guide:둘째 장면'])
  expect(ends).toEqual(['첫 장면', '둘째 장면'])
})

test('stop 하면 기다리던 문장은 읽지 않는다', async () => {
  const { result } = renderHook(() => useAudio())
  act(() => {
    result.current.speak('첫 장면')
    result.current.speak('둘째 장면')
  })
  await act(() => vi.advanceTimersByTimeAsync(100)) // 첫 문장 읽는 중
  act(() => result.current.stop())
  await act(() => vi.advanceTimersByTimeAsync(2_000))
  expect(started).toEqual(['guide:첫 장면'])
})
