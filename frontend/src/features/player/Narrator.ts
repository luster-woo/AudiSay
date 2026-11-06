import type { VoiceChannel } from '@/features/announcer/context'
import { guideAudioUrl } from '@/features/audio/guideVoice'

/** 낭독기 안내가 끝나기를 기다리는 최대 시간. 너무 길면 해설이 영상과 어긋난다 */
const MAX_QUIET_WAIT_MS = 6000

/**
 * 소리 한 채널. 해설 음성(S3)·안내 목소리(Supertonic)·브라우저 음성(TTS)을 한 번에 하나만 낸다 (원칙 1장).
 * React 밖의 보통 객체라 재생 루프 안에서 ref 로 들고 쓴다.
 * Announcer 에 이어(bindVoice) 낭독기 안내와 번갈아 소리를 낸다.
 */
export interface VoiceItem {
  text: string
  /** 없거나 재생에 실패하면 브라우저 음성으로 text 를 읽는다 */
  audioUrl?: string | null
  /** 1 = 보통. 음성 파일은 playbackRate, 브라우저 음성은 rate */
  rate?: number
  /** 403(주소 만료) 등으로 실패했을 때 새 주소를 받아오는 함수. 한 번만 시도 */
  refreshUrl?: () => Promise<string | null>
  /** 이미 다른 소리가 나는 중이면 끼어들지 않고 버린다 */
  skipIfBusy?: boolean
}

interface Pending {
  item: VoiceItem
  resolve: (played: boolean) => void
}

export class Narrator implements VoiceChannel {
  private queue: Pending[] = []
  private current: Pending | null = null
  private audio: HTMLAudioElement | null = null
  private utterance: SpeechSynthesisUtterance | null = null
  private generation = 0
  private lastItem: VoiceItem | null = null
  private busyListeners = new Set<(busy: boolean) => void>()
  private notifiedBusy = false
  private quietWait: (() => number) | null = null

  get busy() {
    return this.current !== null
  }

  /** 마지막으로 읽기 시작한 소리 ('방금 거 다시' 명령용) */
  get last(): VoiceItem | null {
    return this.lastItem
  }

  /** 말하기 시작·끝 알림. 줄에 다음 소리가 이어지면 그 사이에는 끝을 알리지 않는다 */
  onBusyChange(listener: (busy: boolean) => void) {
    this.busyListeners.add(listener)
    return () => {
      this.busyListeners.delete(listener)
    }
  }

  /** 소리를 내기 전에 기다릴 시간(ms)을 묻는 함수 — 낭독기가 안내를 읽는 중이면 그만큼 기다린다 */
  setQuietWait(fn: (() => number) | null) {
    this.quietWait = fn
  }

  private setBusy(busy: boolean) {
    if (this.notifiedBusy === busy) return
    this.notifiedBusy = busy
    this.busyListeners.forEach((l) => l(busy))
  }

  /** 줄 끝에 넣고, 다 읽혔을 때(또는 끊겼을 때) 끝난다. 읽었으면 true */
  say(item: VoiceItem): Promise<boolean> {
    if (item.skipIfBusy && this.busy) return Promise.resolve(false)
    return new Promise((resolve) => {
      this.queue.push({ item, resolve })
      if (!this.current) void this.next()
    })
  }

  /** 지금 소리와 줄 전체를 멈춘다 */
  stop() {
    this.generation += 1
    const pending = [...this.queue]
    this.queue = []
    pending.forEach((p) => p.resolve(false))
    this.cutCurrent()
    const cur = this.current
    this.current = null
    cur?.resolve(false)
    this.setBusy(false)
  }

  private cutCurrent() {
    if (this.audio) {
      this.audio.onended = null
      this.audio.onerror = null
      this.audio.pause()
      this.audio.src = ''
      this.audio = null
    }
    if (this.utterance) {
      this.utterance.onend = null
      this.utterance.onerror = null
      this.utterance = null
      window.speechSynthesis?.cancel()
    }
  }

  private async next() {
    const p = this.queue.shift()
    if (!p) {
      this.setBusy(false)
      return
    }
    this.current = p
    this.lastItem = p.item
    this.setBusy(true)
    const gen = this.generation
    let played = false
    try {
      played = await this.playOne(p.item, gen)
    } finally {
      if (gen === this.generation) {
        this.current = null
        p.resolve(played)
        void this.next()
      }
    }
  }

  private async playOne(item: VoiceItem, gen: number): Promise<boolean> {
    // 낭독기가 방금 받은 안내를 읽는 중이면 끝날 때까지(어림) 기다렸다가 낸다
    const wait = Math.min(MAX_QUIET_WAIT_MS, this.quietWait?.() ?? 0)
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait))
      if (gen !== this.generation) return false
    }
    const rate = item.rate ?? 1
    if (item.audioUrl) {
      if (await this.playUrl(item.audioUrl, rate)) return true
      if (gen !== this.generation) return false
      const fresh = item.refreshUrl ? await item.refreshUrl().catch(() => null) : null
      if (gen !== this.generation) return false
      if (fresh && (await this.playUrl(fresh, rate))) return true
      if (gen !== this.generation) return false
    }
    // 음성 파일이 없거나 재생하지 못하면 안내 목소리(Supertonic) → 그것도 안 되면 브라우저 음성
    const guide = await guideAudioUrl(item.text)
    if (gen !== this.generation) return false
    if (guide && (await this.playUrl(guide, rate))) return true
    if (gen !== this.generation) return false
    return this.speak(item.text, rate)
  }

  private playUrl(url: string, rate: number): Promise<boolean> {
    return new Promise((resolve) => {
      const el = new Audio(url)
      el.playbackRate = rate
      el.onended = () => {
        if (this.audio === el) this.audio = null
        resolve(true)
      }
      el.onerror = () => {
        if (this.audio === el) this.audio = null
        resolve(false)
      }
      this.audio = el
      el.play().catch(() => {
        if (this.audio === el) this.audio = null
        resolve(false)
      })
    })
  }

  private speak(text: string, rate: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || !text) {
        resolve(false)
        return
      }
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'ko-KR'
      u.rate = rate
      u.onend = () => {
        if (this.utterance === u) this.utterance = null
        resolve(true)
      }
      u.onerror = () => {
        if (this.utterance === u) this.utterance = null
        resolve(false)
      }
      this.utterance = u
      window.speechSynthesis.speak(u)
    })
  }
}

/** 음성 파일이 없을 때 읽는 데 걸릴 시간을 글자 수로 어림한다 (한국어 TTS 초당 5~6자) */
export const estimateSpeechMs = (text: string) => Math.max(800, text.length * 180)
