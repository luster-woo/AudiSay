import { useCallback, useEffect, useRef, useState } from 'react'
import { sttApi } from '@/api/stt'
import { ApiError } from '@/api/errors'
import { playBeep } from './beep'

export type VoiceState = 'idle' | 'listening' | 'processing' | 'error'
export const MAX_RECORD_SEC = 60

interface Options {
  /** 글자로 바꾼 결과 */
  onResult: (text: string) => void
  /** 마이크를 쓸 수 없을 때 (권한 거부, 장치 없음) */
  onUnavailable: (reason: string) => void
}

/**
 * 마이크로 녹음 → POST /stt 로 글자 변환.
 * 최대 60초, 지나면 자동으로 끝낸다. 알아듣지 못하면(CHAT_001) state 가 'error'.
 */
export function useVoiceRecorder({ onResult, onUnavailable }: Options) {
  const [state, setState] = useState<VoiceState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const cancelledRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (timerRef.current != null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }

  const releaseMic = () => {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop())
    recorderRef.current = null
  }

  const transcribe = useCallback(
    async (blob: Blob) => {
      setState('processing')
      try {
        const { text } = await sttApi.transcribe(blob)
        if (!text.trim()) throw new ApiError('CHAT_001', 422, '')
        setState('idle')
        onResult(text.trim())
      } catch {
        // CHAT_001(못 알아들음)이든 서버 문제든, 사용자가 할 일은 같다: 다시 말하거나 글자로 찾기
        setState('error')
      }
    },
    [onResult],
  )

  const stop = useCallback(() => {
    clearTimer()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    stop()
    releaseMic()
    setState('idle')
  }, [stop])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onUnavailable('이 브라우저에서는 음성으로 찾기를 쓸 수 없어요.')
      return false
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onUnavailable('마이크를 쓸 수 없어요. 브라우저에서 마이크 권한을 허용해 주세요.')
      return false
    }
    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder
    chunksRef.current = []
    cancelledRef.current = false
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      releaseMic()
      if (!cancelledRef.current) void transcribe(blob)
    }
    setElapsed(0)
    setState('listening')
    playBeep()
    recorder.start()
    const startedAt = Date.now()
    timerRef.current = window.setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000)
      setElapsed(sec)
      if (sec >= MAX_RECORD_SEC) stop()
    }, 250)
    return true
  }, [onUnavailable, stop, transcribe])

  // 화면을 떠나면 마이크를 반드시 끈다
  useEffect(
    () => () => {
      cancelledRef.current = true
      clearTimer()
      releaseMic()
    },
    [],
  )

  /** 오류 화면에서 '글자로 찾기'를 고르면 처음 상태로 */
  const reset = useCallback(() => setState('idle'), [])

  return { state, elapsed, start, stop, cancel, reset }
}
