import { useCallback, useEffect, useRef } from 'react'
import { guideAudioUrl } from './guideVoice'

interface PlayOptions {
  /** audioUrl 이 null 이거나 재생이 실패했을 때 안내 목소리(없으면 브라우저 음성)로 읽을 문장 */
  text: string
  /** 403(만료) 시 새 주소를 받아오는 함수. 한 번만 시도한다 */
  refreshUrl?: () => Promise<string | null>
  rate?: number
  onEnd?: () => void
}

export function useAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const genRef = useRef(0) // stop 뒤에 늦게 도착한 안내 목소리가 울리지 않게

  const stop = useCallback(() => {
    genRef.current += 1
    audioRef.current?.pause()
    audioRef.current = null
    window.speechSynthesis?.cancel()
  }, [])

  const playUrl = useCallback(
    (url: string, rate: number) =>
      new Promise<void>((resolve, reject) => {
        audioRef.current?.pause()
        const el = new Audio(url)
        el.playbackRate = rate
        el.onended = () => resolve()
        el.onerror = () => reject(new Error('audio-error'))
        audioRef.current = el
        el.play().catch(reject)
      }),
    [],
  )

  const browserSpeak = useCallback((text: string, rate: number, onEnd?: () => void) => {
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

  /** 음성 파일이 없는 문장: 안내 목소리(Supertonic) → 못 만들면 브라우저 음성 */
  const speak = useCallback(
    (text: string, rate = 1, onEnd?: () => void) => {
      const gen = genRef.current
      void guideAudioUrl(text).then(async (url) => {
        if (gen !== genRef.current) return
        if (url) {
          try {
            await playUrl(url, rate)
            if (gen === genRef.current) onEnd?.()
            return
          } catch {
            /* 아래 브라우저 음성 */
          }
        }
        if (gen === genRef.current) browserSpeak(text, rate, onEnd)
      })
    },
    [browserSpeak, playUrl],
  )

  const play = useCallback(
    async (audioUrl: string | null, opts: PlayOptions) => {
      stop()
      if (!audioUrl) {
        speak(opts.text, opts.rate, opts.onEnd)
        return
      }
      const rate = opts.rate ?? 1
      try {
        await playUrl(audioUrl, rate)
        opts.onEnd?.()
      } catch {
        // 만료 가능성 → 새 주소 1회 재시도, 그래도 안 되면 안내 목소리
        const fresh = opts.refreshUrl ? await opts.refreshUrl().catch(() => null) : null
        if (fresh) {
          try {
            await playUrl(fresh, rate)
            opts.onEnd?.()
            return
          } catch {
            /* 아래 안내 목소리 */
          }
        }
        speak(opts.text, opts.rate, opts.onEnd)
      }
    },
    [playUrl, speak, stop],
  )

  useEffect(() => stop, [stop]) // 언마운트 시 정리

  return { play, stop, speak }
}
