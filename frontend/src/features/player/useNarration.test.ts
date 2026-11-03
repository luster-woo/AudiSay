import { act, renderHook } from '@testing-library/react'
import type { Description, NarrationLine, ScreenText, UserSettings } from '@/api/types'
import { DEFAULT_SETTINGS } from '@/api/types'
import type { Narrator } from './Narrator'
import type { PlayerControls, PlayerState } from './usePlayerSource'
import { sceneAtMs, screenTextToRead, useNarration } from './useNarration'

const T = (s: number) => s * 1000

const line = (
  lineId: number,
  startMs: number,
  text: string,
  over: Partial<NarrationLine> = {},
): NarrationLine => ({
  lineId,
  lineIndex: lineId,
  detailLevel: 2,
  startMs,
  gapEndMs: startMs + 4000,
  importance: 2,
  text,
  audioUrl: null,
  audioDurationMs: 2000,
  ...over,
})

const description: Description = {
  descriptionId: 20,
  videoId: 15,
  status: 'PUBLISHED',
  coveredUntilMs: null,
  createdAt: '2026-11-01T00:00:00Z',
  // 1번: 빈 구간 4초, 음성 2초 → 멈추지 않아도 됨
  // 2번: 빈 구간 1초, 음성 3초 → 자동 모드에서는 멈추고 읽음
  // 3번: 중요도 1 (낮음), 4번: 2초 뒤에 오는 중요도 3
  lines: [
    line(1, T(10), '첫 문장'),
    line(2, T(20), '긴 문장', { gapEndMs: T(21), audioDurationMs: 3000, importance: 3 }),
    line(3, T(30), '덜 중요한 문장', { importance: 1 }),
    line(4, T(32), '중요한 문장', { importance: 3 }),
    // 상세도는 누적이라 2 기본에서는 1·2단계만 들리고, 3단계 문장은 '자세히'에서만 더해진다
    line(9, T(10), '3단계 문장', { detailLevel: 3 }),
  ],
  scenes: [
    { sceneId: 1, sceneIndex: 1, title: '시작', startMs: 0, endMs: T(15) },
    { sceneId: 2, sceneIndex: 2, title: '본론', startMs: T(15), endMs: T(60) },
  ],
  dialogues: [],
  screenTexts: [
    {
      screenTextId: 1,
      startMs: T(40),
      endMs: T(45),
      textType: 'SCOREBOARD',
      importance: 'HIGH',
      headline: null,
      fullText: '1 대 0',
      summaryText: null,
      sameAsDialogue: false,
    },
  ],
}

/** 가짜 Narrator: say 는 바로 끝나고(또는 pending 으로 붙잡고) 무엇을 읽었는지 남긴다 */
function fakeNarrator(opts: { hold?: boolean } = {}) {
  const resolvers: ((v: boolean) => void)[] = []
  const n = {
    busy: false,
    say: vi.fn((item: { text: string }) => {
      void item
      if (!opts.hold) return Promise.resolve(true)
      n.busy = true
      return new Promise<boolean>((r) => resolvers.push(r))
    }),
    stop: vi.fn(() => {
      n.busy = false
      resolvers.splice(0).forEach((r) => r(false))
    }),
    /** 붙잡아 둔 읽기를 끝낸다 */
    finish: () => {
      n.busy = false
      resolvers.splice(0).forEach((r) => r(true))
    },
  }
  return n
}

function setup(settings: Partial<UserSettings> = {}, narrator = fakeNarrator()) {
  const controls: PlayerControls = {
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
  }
  const announce = vi.fn()
  const refreshAudioUrl = vi.fn(async () => null)
  const base: PlayerState = {
    ready: true,
    playing: true,
    ended: false,
    currentMs: 0,
    durationMs: T(60),
  }
  const hook = renderHook(
    ({ state }: { state: PlayerState }) =>
      useNarration({
        description,
        state,
        controls,
        settings: { ...DEFAULT_SETTINGS, narrationMode: 'AUTO', ...settings },
        narrator: narrator as unknown as Narrator,
        refreshAudioUrl,
        announce,
      }),
    { initialProps: { state: base } },
  )
  /** 재생 시각을 조금씩 옮긴다 (timeupdate 처럼) */
  const tick = (ms: number, patch: Partial<PlayerState> = {}) =>
    act(() => hook.rerender({ state: { ...base, ...patch, currentMs: ms } }))
  /** 1초씩 걸어서 옮긴다 (큰 이동으로 치지 않게) */
  const walk = (fromMs: number, toMs: number) => {
    for (let ms = fromMs; ms < toMs; ms += 1000) tick(ms)
    tick(toMs)
  }
  const said = () => narrator.say.mock.calls.map((c) => (c[0] as { text: string }).text)
  return { hook, tick, walk, controls, narrator, announce, said }
}

const flush = () => act(async () => undefined)

test('문장 시각을 지나면 읽고, 지금 문장은 마지막으로 지난 문장이다', async () => {
  const { hook, tick, said } = setup()
  tick(T(9.5))
  tick(T(10.2))
  expect(said()).toEqual(['첫 문장'])
  expect(hook.result.current.currentLine?.text).toBe('첫 문장')
  // 지금 상세도(2)보다 높은 3단계 문장은 읽지도 보이지도 않는다
  expect(hook.result.current.lines.map((l) => l.lineId)).toEqual([1, 2, 3, 4])
})

test('자동: 빈 구간보다 음성이 길면 영상을 멈추고 읽은 뒤 이어서 재생한다', async () => {
  const narrator = fakeNarrator({ hold: true })
  const { tick, controls } = setup({ narrationMode: 'AUTO' }, narrator)
  tick(T(9.5))
  tick(T(10.2))
  expect(controls.pause).not.toHaveBeenCalled() // 1번은 빈 구간이 넉넉해서 함께 읽는다
  narrator.finish()
  await flush()

  tick(T(19.8))
  tick(T(20.1))
  expect(controls.pause).toHaveBeenCalledTimes(1) // 2번은 멈추고 읽는다
  expect(controls.play).not.toHaveBeenCalled()
  narrator.finish()
  await flush()
  expect(controls.play).toHaveBeenCalledTimes(1) // 다 읽으면 이어서 재생
})

test('영상과 함께: 멈추지 않고, 읽는 중에 덜 중요한 문장이 오면 버리고 더 중요한 문장이 오면 끊고 읽는다', async () => {
  const narrator = fakeNarrator({ hold: true })
  const { tick, walk, controls, said } = setup({ narrationMode: 'WITH_VIDEO' }, narrator)
  tick(T(19.8)) // 0 → 19.8 은 큰 이동이라 한 번 끊는다 (아직 읽은 게 없다)
  narrator.stop.mockClear()
  tick(T(20.1)) // 중요도 3, 빈 구간이 짧아도 멈추지 않는다
  expect(controls.pause).not.toHaveBeenCalled()
  narrator.finish()
  await flush()

  walk(T(21), T(29.8))
  tick(T(30.1)) // 중요도 1 → 읽기 시작 (붙잡아 둠)
  tick(T(31.2))
  tick(T(32.1)) // 중요도 3 → 읽던 것을 끊고 읽는다
  expect(said()).toEqual(['긴 문장', '덜 중요한 문장', '중요한 문장'])
  expect(narrator.stop).toHaveBeenCalledTimes(1)
  expect(controls.pause).not.toHaveBeenCalled()

  // 반대로, 높은 문장을 읽는 중에 낮은 문장이 오면 버린다
  narrator.finish()
  await flush()
  tick(T(31.5)) // 1.5초 뒤로 → 큰 이동이 아니라 그대로 센다
  tick(T(32.2)) // 4번 다시 (시각을 지났으므로)
  tick(T(33.0))
  expect(said().slice(-1)).toEqual(['중요한 문장'])
})

test('멈추고: 문장마다 영상을 멈춘다', async () => {
  const narrator = fakeNarrator({ hold: true })
  const { tick, controls } = setup({ narrationMode: 'PAUSE_AFTER' }, narrator)
  tick(T(9.5))
  tick(T(10.2))
  expect(controls.pause).toHaveBeenCalledTimes(1)
  narrator.finish()
  await flush()
  expect(controls.play).toHaveBeenCalledTimes(1)
})

test('재생바로 크게 옮기면 읽던 소리를 끊고, 건너뛴 문장은 읽지 않는다. 멈춰 둔 상태였으면 이어서 재생', async () => {
  const narrator = fakeNarrator({ hold: true })
  const { hook, tick, controls, said } = setup({ narrationMode: 'PAUSE_AFTER' }, narrator)
  tick(T(9.5))
  tick(T(10.2)) // 멈추고 읽는 중
  expect(controls.pause).toHaveBeenCalledTimes(1)
  act(() => hook.result.current.interrupt())
  expect(narrator.stop).toHaveBeenCalled()
  expect(controls.play).toHaveBeenCalledTimes(1) // 사용자는 재생 중이라고 알고 있으니 이어서 재생
  await flush()
  expect(controls.play).toHaveBeenCalledTimes(1) // holdWhile 이 끝나도 두 번 재생하지 않는다

  tick(T(35)) // 2·3·4번 문장을 한꺼번에 건너뜀
  expect(said()).toEqual(['첫 문장'])
  expect(hook.result.current.currentLine?.text).toBe('중요한 문장') // 화면에는 보인다
})

test('대사만: 아무것도 읽지 않지만 지금 문장은 보인다', () => {
  const { hook, tick, said } = setup({ soundMix: 'DIALOGUE_ONLY' })
  tick(T(9.5))
  tick(T(10.2))
  expect(said()).toEqual([])
  expect(hook.result.current.currentLine?.text).toBe('첫 문장')
})

test('멈춘 상태에서는 시각이 흘러도 읽지 않는다', () => {
  const { tick, said } = setup()
  tick(T(9.5), { playing: false })
  tick(T(10.2), { playing: false })
  expect(said()).toEqual([])
})

test('화면 글자는 상세도·자막 설정 규칙대로 읽고, 다른 소리가 나는 중이면 버린다', () => {
  const { tick, narrator } = setup({ detailLevel: 2 })
  tick(T(39.8))
  tick(T(40.1))
  expect(narrator.say).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: '1 대 0', skipIfBusy: true }),
  )
})

test('부분 해설: 해설이 있는 구간 끝을 지나면 한 번만 알린다', () => {
  const { tick, announce } = setup()
  // description 은 공용이라 coveredUntilMs 만 바꾼 사본을 쓰기 어렵다 → 훅에 직접 넣는다
  void tick
  const controls: PlayerControls = {
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
  }
  const base: PlayerState = {
    ready: true,
    playing: true,
    ended: false,
    currentMs: 0,
    durationMs: T(60),
  }
  const hook = renderHook(
    ({ state }: { state: PlayerState }) =>
      useNarration({
        description: { ...description, coveredUntilMs: T(50) },
        state,
        controls,
        settings: DEFAULT_SETTINGS,
        narrator: fakeNarrator() as unknown as Narrator,
        refreshAudioUrl: async () => null,
        announce,
      }),
    { initialProps: { state: base } },
  )
  act(() => hook.rerender({ state: { ...base, currentMs: T(49.8) } }))
  act(() => hook.rerender({ state: { ...base, currentMs: T(50.1) } }))
  act(() => hook.rerender({ state: { ...base, currentMs: T(50.4) } }))
  expect(announce).toHaveBeenCalledTimes(1)
  expect(announce).toHaveBeenCalledWith('여기부터는 해설이 없어요. 영상 소리만 나와요.')
})

describe('screenTextToRead (명세 CNT-03 · SND-03)', () => {
  const base: ScreenText = {
    screenTextId: 1,
    startMs: 0,
    endMs: 1000,
    textType: 'CAPTION',
    importance: 'HIGH',
    headline: null,
    fullText: '원문',
    summaryText: '요약',
    sameAsDialogue: false,
  }
  test.each([
    ['HIGH', 1, null],
    ['HIGH', 2, '원문'],
    ['HIGH', 3, '원문'],
    ['MEDIUM', 2, null],
    ['MEDIUM', 3, '요약'],
    ['LOW', 3, null],
  ] as const)('중요도 %s · 상세도 %i → %s', (importance, level, expected) => {
    expect(screenTextToRead({ ...base, importance }, level, 'ALL')).toBe(expected)
  })
  test('긴 글은 제목만 읽는다', () => {
    expect(screenTextToRead({ ...base, headline: '제목' }, 2, 'ALL')).toBe('제목')
  })
  test('자막: 끄기면 안 읽고, 다른 것만이면 대사와 같은 자막은 건너뛴다', () => {
    const sub = { ...base, textType: 'SUBTITLE' }
    expect(screenTextToRead(sub, 2, 'OFF')).toBeNull()
    expect(screenTextToRead({ ...sub, sameAsDialogue: true }, 2, 'DIFFERENT_ONLY')).toBeNull()
    expect(screenTextToRead(sub, 2, 'DIFFERENT_ONLY')).toBe('원문')
    expect(screenTextToRead({ ...sub, sameAsDialogue: true }, 2, 'ALL')).toBe('원문')
  })
})

test('sceneAtMs: 시각이 든 장면을 찾는다 (끝 시각은 다음 장면)', () => {
  expect(sceneAtMs(description.scenes, T(14))?.title).toBe('시작')
  expect(sceneAtMs(description.scenes, T(15))?.title).toBe('본론')
  expect(sceneAtMs(description.scenes, T(60))).toBeNull()
  expect(sceneAtMs(undefined, 0)).toBeNull()
})
