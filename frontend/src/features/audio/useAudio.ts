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
  // speak 는 부른 순서대로 하나씩 읽는다(브라우저 음성일 때와 같게). 앞 문장이 끝나야 다음 문장을 낸다
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  const stop = useCallback(() => {
    genRef.current += 1
    queueRef.current = Promise.resolve()
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

  /** 브라우저 음성으로 읽고, 끝나면(또는 실패하면) 끝나는 Promise */
  const browserSpeak = useCallback(
    (text: string, rate: number) =>
      new Promise<void>((resolve) => {
        if (!('speechSynthesis' in window)) {
          resolve()
          return
        }
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'ko-KR'
        u.rate = rate
        u.onend = () => resolve()
        u.onerror = () => resolve()
        window.speechSynthesis.speak(u)
      }),
    [],
  )

  /**
   * 음성 파일이 없는 문장: 안내 목소리(Supertonic) → 못 만들면 브라우저 음성.
   * 안내 목소리 주소는 바로 요청해 두고(앞 문장을 읽는 동안 받아 둠), 읽기는 줄 순서대로 한다.
   * 그래서 늦게 도착한 앞 요청이 뒤 문장보다 나중에 울리거나, 새 문장이 앞 문장을 끊는 일이 없다.
   * 멈추려면 stop() — 줄 전체를 비운다.
   */
  const speak = useCallback(
    (text: string, rate = 1, onEnd?: () => void) => {
      const gen = genRef.current
      const url = guideAudioUrl(text)
      const run = async () => {
        if (gen !== genRef.current) return
        const guide = await url
        if (gen !== genRef.current) return
        if (guide) {
          try {
            await playUrl(guide, rate)
            if (gen === genRef.current) onEnd?.()
            return
          } catch {
            if (gen !== genRef.current) return
            /* 아래 브라우저 음성 */
          }
        }
        await browserSpeak(text, rate)
        if (gen === genRef.current) onEnd?.()
      }
      queueRef.current = queueRef.current.then(run, run)
    },
    [browserSpeak, playUrl],
  )

  const play = useCallback(
    async (audioUrl: string | null, opts: PlayOptions) => {
      stop()
      const gen = genRef.current
      if (!audioUrl) {
        speak(opts.text, opts.rate, opts.onEnd)
        return
      }
      const rate = opts.rate ?? 1
      try {
        await playUrl(audioUrl, rate)
        if (gen === genRef.current) opts.onEnd?.()
      } catch {
        if (gen !== genRef.current) return
        // 만료 가능성 → 새 주소 1회 재시도, 그래도 안 되면 안내 목소리
        const fresh = opts.refreshUrl ? await opts.refreshUrl().catch(() => null) : null
        if (gen !== genRef.current) return
        if (fresh) {
          try {
            await playUrl(fresh, rate)
            if (gen === genRef.current) opts.onEnd?.()
            return
          } catch {
            if (gen !== genRef.current) return
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
