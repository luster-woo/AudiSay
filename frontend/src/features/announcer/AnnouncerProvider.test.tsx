import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AnnouncerProvider } from './AnnouncerProvider'
import { estimateReaderMs, useAnnouncer, type VoiceChannel } from './context'

/** 가짜 우리 음성: busy 를 테스트가 직접 바꾼다 */
class FakeVoice implements VoiceChannel {
  busy = false
  stopped = 0
  quietWait: (() => number) | null = null
  private listeners = new Set<(busy: boolean) => void>()
  stop = () => {
    this.stopped += 1
    this.set(false)
  }
  onBusyChange = (l: (busy: boolean) => void) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }
  setQuietWait = (fn: (() => number) | null) => {
    this.quietWait = fn
  }
  set(busy: boolean) {
    this.busy = busy
    this.listeners.forEach((l) => l(busy))
  }
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <AnnouncerProvider>{children}</AnnouncerProvider>
)
const polite = () => document.querySelector('[aria-live="polite"]')?.textContent
const assertive = () => document.querySelector('[aria-live="assertive"]')?.textContent
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))

function setup() {
  const { result } = renderHook(() => useAnnouncer(), { wrapper })
  const voice = new FakeVoice()
  let unbind = () => {}
  act(() => {
    unbind = result.current.bindVoice(voice)
  })
  return { api: () => result.current, voice, unbind: () => act(() => unbind()) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('우리 음성이 말하지 않을 때는 바로 읽고, 우리 음성은 안내 길이만큼 기다린다', () => {
  const { api, voice } = setup()
  act(() => api().announce('재생해요.'))
  wait(20)
  expect(polite()).toBe('재생해요.')
  const left = voice.quietWait!()
  expect(left).toBeGreaterThan(0)
  expect(left).toBeLessThanOrEqual(estimateReaderMs('재생해요.'))
  wait(estimateReaderMs('재생해요.'))
  expect(voice.quietWait!()).toBe(0)
})

test('우리 음성이 말하는 동안 polite 안내는 미뤘다가 끝나면 읽는다', () => {
  const { api, voice } = setup()
  act(() => voice.set(true))
  act(() => api().announce('즐겨찾기에 넣었어요.'))
  wait(1000)
  expect(polite()).toBe('')
  expect(api().lastMessage).toBe('즐겨찾기에 넣었어요.') // 보이는 띠는 바로 바뀐다
  act(() => voice.set(false))
  wait(400)
  expect(polite()).toBe('즐겨찾기에 넣었어요.')
})

test('문장 사이에 잠깐 쉬는 동안에는 내보내지 않고, 미룬 안내는 한 번에 이어 읽는다', () => {
  const { api, voice } = setup()
  act(() => voice.set(true))
  act(() => {
    api().announce('장면 목차를 열었어요.')
    api().announce('장면 목차를 열었어요.')
    api().announce('즐겨찾기에 넣었어요.')
  })
  act(() => voice.set(false))
  wait(100)
  act(() => voice.set(true)) // 다음 답변 문장
  wait(1000)
  expect(polite()).toBe('')
  act(() => voice.set(false))
  wait(400)
  expect(polite()).toBe('장면 목차를 열었어요. 즐겨찾기에 넣었어요.')
})

test('assertive 안내는 우리 음성을 끊고 바로 읽는다', () => {
  const { api, voice } = setup()
  act(() => voice.set(true))
  act(() => api().announce('보내지 못했어요.', { politeness: 'assertive' }))
  wait(20)
  expect(voice.stopped).toBe(1)
  expect(assertive()).toBe('보내지 못했어요.')
})

test('연결을 풀면 미뤄 둔 안내를 바로 읽는다', () => {
  const { api, voice, unbind } = setup()
  act(() => voice.set(true))
  act(() => api().announce('멈췄어요.'))
  unbind()
  wait(20)
  expect(polite()).toBe('멈췄어요.')
  expect(voice.quietWait).toBeNull()
})
