import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Playback } from '@/api/types'
import { usePlayerSource, type PlayerControls, type PlayerState } from './usePlayerSource'

/* 유튜브 IFrame API 흉내: 상태·시각만 갖고, 부른 함수를 기록한다 */
const State = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }
let fake: {
  state: number
  time: number
  events: { onReady?: () => void; onStateChange?: (e: { data: number }) => void }
  seekTo: ReturnType<typeof vi.fn>
  playVideo: ReturnType<typeof vi.fn>
  pauseVideo: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.stubGlobal('YT', {
    PlayerState: State,
    Player: class {
      constructor(_el: unknown, opts: { events: typeof fake.events }) {
        fake = {
          state: State.UNSTARTED,
          time: 0,
          events: opts.events,
          seekTo: vi.fn((sec: number) => {
            fake.time = sec
          }),
          playVideo: vi.fn(),
          pauseVideo: vi.fn(),
        }
        return Object.assign(this, {
          getIframe: () => null,
          getDuration: () => 600,
          getCurrentTime: () => fake.time,
          getPlayerState: () => fake.state,
          seekTo: fake.seekTo,
          playVideo: fake.playVideo,
          pauseVideo: fake.pauseVideo,
          unloadModule: () => {},
          setVolume: () => {},
          destroy: () => {},
        })
      }
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

const playback: Playback = {
  sourceType: 'YOUTUBE',
  playbackUrl: null,
  playbackFormat: null,
  expiresAt: null,
  youtubeVideoId: 'abc',
}

function setup() {
  const out: { state?: PlayerState; controls?: PlayerControls } = {}
  function Harness() {
    const { ytHostRef, state, controls } = usePlayerSource(playback, 600)
    out.state = state
    out.controls = controls
    return <div ref={ytHostRef} />
  }
  render(<Harness />)
  return out
}

test('유튜브를 한 번도 틀지 않았을 때 옮기면 위치만 기억하고, 재생할 때 그 자리부터 튼다', async () => {
  const p = setup()
  await waitFor(() => expect(fake).toBeDefined())
  act(() => fake.events.onReady?.())
  await waitFor(() => expect(p.state?.ready).toBe(true))

  // 시작 전 seekTo 는 재생을 시작해 버리므로 플레이어는 건드리지 않는다
  act(() => p.controls!.seek(90_000))
  expect(fake.seekTo).not.toHaveBeenCalled()
  expect(fake.pauseVideo).not.toHaveBeenCalled()
  expect(p.state?.currentMs).toBe(90_000)

  // 재생: 기억해 둔 자리로 옮기며 튼다
  act(() => p.controls!.play())
  expect(fake.seekTo).toHaveBeenCalledWith(90, true)
  expect(fake.playVideo).not.toHaveBeenCalled()

  // 재생이 시작되면 기억은 지우고, 그 뒤 이동은 바로 플레이어로 간다
  act(() => {
    fake.state = State.PLAYING
    fake.events.onStateChange?.({ data: State.PLAYING })
  })
  act(() => p.controls!.seek(30_000))
  expect(fake.seekTo).toHaveBeenLastCalledWith(30, true)
  expect(fake.pauseVideo).not.toHaveBeenCalled()
})
