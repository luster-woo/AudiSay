import { useContext, useEffect, type ReactNode } from 'react'
import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AnnouncerProvider, LiveRegions } from './AnnouncerProvider'
import { LiveHostContext, estimateReaderMs, useAnnouncer, type VoiceChannel } from './context'

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

test('키를 누르면 낭독기가 읽던 말을 멈추므로, 우리 음성은 더 기다리지 않는다', () => {
  const { api, voice } = setup()
  act(() => api().announce('영상 보기예요. 30초 요약을 들을까요? Enter는 듣기, Esc는 건너뛰기.'))
  wait(20)
  expect(voice.quietWait!()).toBeGreaterThan(0)
  // 수식키만 누른 것은 그대로
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })))
  expect(voice.quietWait!()).toBeGreaterThan(0)
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
  expect(voice.quietWait!()).toBe(0)
})

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

test('창이 열리면 안내 영역을 옮기지 않고, 창 안에 미리 있던 영역에 방금 안내를 다시 쓴다', () => {
  // 창 역할: 자기 id 로 등록하고 자기 LiveRegions 를 그린다
  function FakeDialog({ open }: { open: boolean }) {
    const register = useContext(LiveHostContext)
    useEffect(() => (open ? register('dlg-1') : undefined), [open, register])
    return (
      <div data-testid="dlg">
        <LiveRegions hostId="dlg-1" />
      </div>
    )
  }
  function Page({ open }: { open: boolean }) {
    const { announce } = useAnnouncer()
    return (
      <>
        <button type="button" onClick={() => announce('영상을 멈췄어요.')}>
          열기
        </button>
        <FakeDialog open={open} />
      </>
    )
  }
  const view = render(<Page open={false} />, { wrapper })
  const bodyRegion = document.querySelectorAll('[aria-live="polite"]')[1] // 본문 영역은 children 뒤에 그려진다
  const dlgRegion = view.getByTestId('dlg').querySelector('[aria-live="polite"]')!

  // 안내를 보낸 직후 창이 열린다 (⑤ 재생 설정과 같은 순서)
  act(() => view.getByRole('button', { name: '열기' }).click())
  view.rerender(<Page open />)
  wait(100)

  expect(dlgRegion.textContent).toBe('영상을 멈췄어요.')
  expect(bodyRegion.textContent).toBe('')
  // 영역 노드는 그대로다 (새로 만들면 크롬이 글자를 '처음부터 있던 내용'으로 보고 읽지 않는다)
  expect(document.querySelectorAll('[aria-live="polite"]')[1]).toBe(bodyRegion)
  expect(view.getByTestId('dlg').querySelector('[aria-live="polite"]')).toBe(dlgRegion)
})

test('우리 음성 중에 누른 다시 듣기는 미뤄 두되, 그사이 새 안내가 오면 다시 듣기는 버리고 새 안내만 읽는다', () => {
  const { api, voice } = setup()
  act(() => api().announce('요약을 들려 드릴게요.'))
  wait(16)
  act(() => voice.set(true)) // 요약 TTS 시작
  act(() => api().repeat()) // Alt+Shift+R
  expect(polite()).toBe('요약을 들려 드릴게요.') // 아직 다시 읽지 않는다
  act(() => api().announce('요약이 끝났어요.'))
  act(() => voice.set(false))
  wait(400)
  expect(polite()).toBe('요약이 끝났어요.')
})
