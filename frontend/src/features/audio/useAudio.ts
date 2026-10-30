import { useCallback, useEffect, useRef } from 'react'

interface PlayOptions {
  /** audioUrl 이 null 이거나 재생이 실패했을 때 TTS 로 읽을 문장 */
  text: string
  /** 403(만료) 시 새 주소를 받아오는 함수. 한 번만 시도한다 */
  refreshUrl?: () => Promise<string | null>
  rate?: number
  onEnd?: () => void
}

export function useAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    window.speechSynthesis?.cancel()
  }, [])

  const speak = useCallback((text: string, rate = 1, onEnd?: () => void) => {
    if (!('speechSynthesis' in window)) {
      onEnd?.()
      return
    }
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ko-KR'
    u.rate = rate
    u.onend = () => onEnd?.()
    window.speechSynthesis.speak(u)
  }, [])

  const play = useCallback(
    async (audioUrl: string | null, opts: PlayOptions) => {
      stop()
      if (!audioUrl) {
        speak(opts.text, opts.rate, opts.onEnd)
        return
      }
      const tryPlay = (url: string) =>
        new Promise<void>((resolve, reject) => {
          const el = new Audio(url)
          el.playbackRate = opts.rate ?? 1
          el.onended = () => resolve()
          el.onerror = () => reject(new Error('audio-error'))
          audioRef.current = el
          el.play().catch(reject)
        })

      try {
        await tryPlay(audioUrl)
        opts.onEnd?.()
      } catch {
        // 만료 가능성 → 새 주소 1회 재시도, 그래도 안 되면 TTS
        const fresh = opts.refreshUrl ? await opts.refreshUrl().catch(() => null) : null
        if (fresh) {
          try {
            await tryPlay(fresh)
            opts.onEnd?.()
            return
          } catch { /* 아래 TTS */ }
        }
        speak(opts.text, opts.rate, opts.onEnd)
      }
    },
    [speak, stop],
  )

  useEffect(() => stop, [stop]) // 언마운트 시 정리

  return { play, stop, speak }
}