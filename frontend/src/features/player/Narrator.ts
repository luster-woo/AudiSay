/**
 * 소리 한 채널. 해설 음성(S3)·브라우저 음성(TTS)을 한 번에 하나만 낸다 (원칙 1장).
 * React 밖의 보통 객체라 재생 루프 안에서 ref 로 들고 쓴다.
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

export class Narrator {
  private queue: Pending[] = []
  private current: Pending | null = null
  private audio: HTMLAudioElement | null = null
  private utterance: SpeechSynthesisUtterance | null = null
  private generation = 0

  get busy() {
    return this.current !== null
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
    if (!p) return
    this.current = p
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
    const rate = item.rate ?? 1
    if (item.audioUrl) {
      if (await this.playUrl(item.audioUrl, rate)) return true
      if (gen !== this.generation) return false
      const fresh = item.refreshUrl ? await item.refreshUrl().catch(() => null) : null
      if (gen !== this.generation) return false
      if (fresh && (await this.playUrl(fresh, rate))) return true
      if (gen !== this.generation) return false
    }
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
