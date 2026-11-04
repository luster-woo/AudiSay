import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const synthesize = vi.fn()
vi.mock('@/api/tts', () => ({ ttsApi: { synthesize: (...a: unknown[]) => synthesize(...a) } }))

import { tokenStore } from '@/api/token'
import { forgetGuideAudio } from '@/features/audio/guideVoice'
import { Narrator } from './Narrator'

/** 가짜 Audio: 주소를 남기고, 'bad'가 들어간 주소는 재생 실패 */
const played: string[] = []
class FakeAudio {
  playbackRate = 1
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  src: string
  constructor(src: string) {
    this.src = src
  }
  play() {
    played.push(this.src)
    if (this.src.includes('bad')) return Promise.reject(new Error('fail'))
    queueMicrotask(() => this.onended?.())
    return Promise.resolve()
  }
  pause() {}
}

const spoken: string[] = []
beforeEach(() => {
  played.length = 0
  spoken.length = 0
  synthesize.mockReset()
  forgetGuideAudio()
  tokenStore.set('access-token')
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('speechSynthesis', {
    speak: (u: { text: string; onend?: () => void }) => {
      spoken.push(u.text)
      queueMicrotask(() => u.onend?.())
    },
    cancel: () => {},
  })
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      lang = ''
      rate = 1
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      text: string
      constructor(text: string) {
        this.text = text
      }
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

test('로그인 전에는 안내 목소리를 부르지 않고 브라우저 음성으로 읽는다', async () => {
  tokenStore.clear()
  await new Narrator().say({ text: '로그인해 주세요.' })
  expect(synthesize).not.toHaveBeenCalled()
  expect(spoken).toEqual(['로그인해 주세요.'])
})

test('음성 파일이 없으면 안내 목소리(Supertonic)로 읽는다', async () => {
  synthesize.mockResolvedValue({
    audioUrl: 'https://s3/guide/a.mp3',
    durationMs: 900,
    latencyMs: 10,
  })
  expect(await new Narrator().say({ text: '장면 설명이에요.' })).toBe(true)
  expect(synthesize).toHaveBeenCalledWith('장면 설명이에요.', undefined, expect.any(AbortSignal))
  expect(played).toEqual(['https://s3/guide/a.mp3'])
  expect(spoken).toEqual([])
})

test('해설 음성 파일이 있으면 안내 목소리를 부르지 않는다', async () => {
  await new Narrator().say({ text: '해설', audioUrl: 'https://s3/kore/1.mp3' })
  expect(synthesize).not.toHaveBeenCalled()
  expect(played).toEqual(['https://s3/kore/1.mp3'])
})

test('안내 목소리를 못 만들면 브라우저 음성으로 읽는다', async () => {
  synthesize.mockResolvedValue({ audioUrl: null, durationMs: null, latencyMs: 5 })
  await new Narrator().say({ text: '안내 문장' })
  expect(spoken).toEqual(['안내 문장'])
  synthesize.mockRejectedValue(new Error('network'))
  await new Narrator().say({ text: '다른 문장' })
  expect(spoken).toEqual(['안내 문장', '다른 문장'])
})

test('같은 문장은 안내 목소리를 다시 요청하지 않는다', async () => {
  synthesize.mockResolvedValue({
    audioUrl: 'https://s3/guide/b.mp3',
    durationMs: 900,
    latencyMs: 10,
  })
  const n = new Narrator()
  await n.say({ text: '재생 화면이에요.' })
  await n.say({ text: '재생 화면이에요.' })
  expect(synthesize).toHaveBeenCalledTimes(1)
  expect(played).toEqual(['https://s3/guide/b.mp3', 'https://s3/guide/b.mp3'])
})
