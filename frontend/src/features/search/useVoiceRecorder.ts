import { useCallback, useEffect, useRef, useState } from 'react'
import { sttApi } from '@/api/stt'
import { ApiError } from '@/api/errors'
import { playBeep } from './beep'
import { MIC_MESSAGES, micErrorMessage, queryMic, watchMic } from './micPermission'

/** preparing: 마이크는 열었고 낭독기가 안내를 읽는 동안 기다린다 ('띠'·녹음 전) */
export type VoiceState = 'idle' | 'preparing' | 'listening' | 'processing' | 'error'

export interface StartOptions {
  /**
   * 한 번 부른다 (영상 멈추기·안내하기). '띠' 소리 전에 기다릴 시간(ms)을 돌려준다 —
   * 낭독기가 안내를 다 읽도록 screenReaderLeadMs(안내 문구) 로 어림한다.
   * 마이크 권한이 이미 허용돼 있으면 마이크를 열기 **전에** 부른다: 크롬이 마이크를 켜는 순간 창 이름에
   * "마이크 녹음 중"을 붙여 낭독기가 그걸 읽는데, 그보다 우리 안내("영상을 멈췄어요…")가 먼저 들리게 한다.
   * 허용 전(팝업이 뜰 수 있음)·거부됨이면 마이크를 연 뒤에 부른다 — 못 열면 안내가 거짓말이 되므로
   */
  prepare?: () => number
}

/** 화면에 보이는 상태 글자 */
export const VOICE_LABEL: Record<VoiceState, string> = {
  idle: '',
  preparing: "곧 '띠' 소리가 나요",
  listening: '듣고 있어요',
  processing: '알아듣는 중이에요',
  error: '알아듣지 못했어요',
}
export const MAX_RECORD_SEC = 60

interface Options {
  /** 글자로 바꾼 결과 */
  onResult: (text: string) => void
  /** 마이크를 쓸 수 없을 때 (권한 거부, 장치 없음, 다른 프로그램이 사용 중). reason 은 이유와 할 일 */
  onUnavailable: (reason: string) => void
  /** 처음 써서 브라우저가 허용 팝업을 띄울 때. 화면을 보지 않는 사용자에게 팝업이 떴다고 알린다 */
  onAsking?: () => void
  /** 막혀 있던 마이크를 사이트 설정에서 허용으로 바꿨을 때 */
  onRecovered?: () => void
}

/**
 * 마이크로 녹음 → POST /stt 로 글자 변환.
 * 최대 60초, 지나면 자동으로 끝낸다. 알아듣지 못하면(CHAT_001) state 가 'error'.
 * 마이크 권한은 허용됨·처음·차단됨 모두 다룬다(micPermission.ts): 처음이면 팝업이 뜬다고 먼저 알리고,
 * 실패하면 이유별로 할 일을 알리며, 차단을 풀면 바로 알아챈다.
 */
export function useVoiceRecorder({ onResult, onUnavailable, onAsking, onRecovered }: Options) {
  const [state, setState] = useState<VoiceState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const cancelledRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const blockedRef = useRef(false) // 차단돼서 실패했는지 (풀리면 onRecovered)
  // preparing 중 기다림을 끝내는 함수 (취소·화면 떠남 때 바로 풀어 준다)
  const leadTimerRef = useRef<number | null>(null)
  const leadDoneRef = useRef<(() => void) | null>(null)
  const endLead = () => {
    if (leadTimerRef.current != null) window.clearTimeout(leadTimerRef.current)
    leadTimerRef.current = null
    leadDoneRef.current?.()
    leadDoneRef.current = null
  }
  const onRecoveredRef = useRef(onRecovered)
  useEffect(() => {
    onRecoveredRef.current = onRecovered
  })

  // 사이트 설정에서 차단을 풀면 다시 누르기 전에 알려 준다
  useEffect(
    () =>
      watchMic((state) => {
        if (state === 'granted' && blockedRef.current) {
          blockedRef.current = false
          onRecoveredRef.current?.()
        }
      }),
    [],
  )

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
    endLead()
    stop()
    releaseMic()
    setState('idle')
  }, [stop])

  const start = useCallback(
    async ({ prepare }: StartOptions = {}) => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        onUnavailable(MIC_MESSAGES.unsupported)
        return false
      }
      const permission = await queryMic()
      // 처음이면 브라우저가 팝업을 띄우고 고를 때까지 기다린다. 그 전에 무슨 일인지 알린다
      if (permission === 'prompt') onAsking?.()
      // 이미 허용돼 있으면 안내를 먼저 보내고 마이크를 연다 (StartOptions.prepare 참고)
      let leadMs = 0
      let preparedAt: number | null = null
      if (permission === 'granted' && prepare) {
        leadMs = prepare()
        preparedAt = Date.now()
      }
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err) {
        const { message, blocked } = await micErrorMessage(err)
        blockedRef.current = blocked
        onUnavailable(message)
        return false
      }
      blockedRef.current = false
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
      // 순서: 안내 → (낭독기가 읽는 동안) 기다림 → '띠' → 녹음. 녹음 중에 낭독기가 말하지 않게 한다
      setElapsed(0)
      setState('preparing')
      if (preparedAt == null) leadMs = prepare?.() ?? 0
      // 안내를 먼저 보냈으면 마이크 여는 데 걸린 시간만큼은 이미 읽었다
      else leadMs = Math.max(0, leadMs - (Date.now() - preparedAt))
      if (leadMs > 0) {
        await new Promise<void>((resolve) => {
          leadDoneRef.current = resolve
          leadTimerRef.current = window.setTimeout(endLead, leadMs)
        })
      }
      if (cancelledRef.current) {
        releaseMic()
        return false
      }
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
    },
    [onUnavailable, onAsking, stop, transcribe],
  )

  // 화면을 떠나면 마이크를 반드시 끈다
  useEffect(
    () => () => {
      cancelledRef.current = true
      endLead()
      clearTimer()
      releaseMic()
    },
    [],
  )

  /** 오류 화면에서 '글자로 찾기'를 고르면 처음 상태로 */
  const reset = useCallback(() => setState('idle'), [])

  return { state, elapsed, start, stop, cancel, reset }
}
