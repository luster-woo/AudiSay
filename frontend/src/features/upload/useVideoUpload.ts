import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadsApi } from '@/api/uploads'
import type { UploadCompleteResult, Visibility } from '@/api/types'
import { contentTypeOf } from './fileRules'
import { uploadParts } from './uploadParts'

export interface UploadDraft {
  file: File
  durationSec: number
  title: string
  visibility: Visibility
}

/**
 * 올리는 중인 업로드 번호를 브라우저에 적어 둔다. 탭이 닫혀 중단 요청(pagehide)이 못 갔으면, 다음에 올릴 때 먼저 정리한다.
 * (정리하지 않으면 서버가 24시간 동안 '올리는 중'으로 붙잡아 일반 회원은 그날 다시 올릴 수 없다)
 */
const PENDING_KEY = 'audisay:pending-upload'
function readPending(): number | null {
  try {
    const v = Number(localStorage.getItem(PENDING_KEY))
    return Number.isInteger(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
function writePending(videoId: number | null) {
  try {
    if (videoId == null) localStorage.removeItem(PENDING_KEY)
    else localStorage.setItem(PENDING_KEY, String(videoId))
  } catch {
    /* 저장할 수 없는 브라우저면 pagehide 중단 요청만 쓴다 */
  }
}

/** idle → starting(사전 검사) → uploading → completing → done(서버가 해설 만들기 시작) / failed(연결 끊김) */
export type UploadPhase = 'idle' | 'starting' | 'uploading' | 'completing' | 'done' | 'failed'

/**
 * 영상 업로드 한 건의 상태.
 * begin() 은 사전 검사(POST /uploads) 실패만 던지고, 조각 전송 실패는 phase 'failed' 로 알린다.
 */
export function useVideoUpload(onDone: (result: UploadCompleteResult) => void) {
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [loaded, setLoaded] = useState(0)
  const [etaSec, setEtaSec] = useState<number | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const videoIdRef = useRef<number | null>(null)
  const draftRef = useRef<UploadDraft | null>(null)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  })

  const transfer = useCallback(
    async (videoId: number, draft: UploadDraft, partSizeBytes: number, partCount: number) => {
      const controller = new AbortController()
      controllerRef.current = controller
      const startedAt = Date.now()
      try {
        const parts = await uploadParts({
          videoId,
          file: draft.file,
          partSizeBytes,
          partCount,
          signal: controller.signal,
          onProgress: (bytes) => {
            setLoaded(bytes)
            const elapsed = (Date.now() - startedAt) / 1000
            // 처음 3초는 속도가 들쭉날쭉해서 남은 시간을 말하지 않는다
            setEtaSec(
              elapsed > 3 && bytes > 0 ? ((draft.file.size - bytes) * elapsed) / bytes : null,
            )
          },
        })
        setPhase('completing')
        const result = await uploadsApi.complete(videoId, parts)
        videoIdRef.current = null
        writePending(null)
        setPhase('done')
        onDoneRef.current(result)
      } catch {
        if (controller.signal.aborted) return // 사용자가 멈춘 경우
        setPhase('failed')
      }
    },
    [],
  )

  /** 사전 검사 후 전송 시작. 검사에서 거절되면 ApiError 를 던진다 */
  const begin = useCallback(
    async (draft: UploadDraft) => {
      draftRef.current = draft
      setPhase('starting')
      setLoaded(0)
      setEtaSec(null)
      try {
        // 지난번에 탭을 닫아 끝나지 않은 업로드가 남아 있으면 먼저 정리한다 (안 하면 '올리는 중인 영상이 있어' 거절)
        const leftover = readPending()
        if (leftover != null) {
          await uploadsApi.abort(leftover).catch(() => undefined)
          writePending(null)
        }
        const started = await uploadsApi.start({
          title: draft.title,
          originalFilename: draft.file.name,
          contentType: contentTypeOf(draft.file) ?? 'video/mp4',
          sizeBytes: draft.file.size,
          durationSec: draft.durationSec,
          visibility: draft.visibility,
          copyrightAgreed: true,
        })
        videoIdRef.current = started.videoId
        writePending(started.videoId)
        setPhase('uploading')
        void transfer(started.videoId, draft, started.partSizeBytes, started.partCount)
      } catch (err) {
        setPhase('idle')
        throw err
      }
    },
    [transfer],
  )

  /** 올라간 조각을 지운다. 이미 지워졌거나 실패해도 사용자에게 할 일은 없다 */
  const discard = useCallback(async () => {
    controllerRef.current?.abort()
    const id = videoIdRef.current
    videoIdRef.current = null
    if (id != null) {
      // 중단이 실패하면(오프라인 등) 적어 둔 번호를 남겨, 다음에 올릴 때 다시 정리한다
      const ok = await uploadsApi.abort(id).then(
        () => true,
        () => false,
      )
      if (ok) writePending(null)
    }
  }, [])

  /** '업로드 멈추기' → 확인 → 멈추기 */
  const stop = useCallback(async () => {
    await discard()
    setPhase('idle')
  }, [discard])

  /** 연결이 끊긴 뒤 '처음부터 다시 올리기' */
  const restart = useCallback(async () => {
    await discard()
    if (draftRef.current) await begin(draftRef.current)
  }, [discard, begin])

  // 올리는 중에 창을 닫거나 새로고침하면 브라우저 확인창을 띄운다 (원칙 8장)
  const busy = phase === 'starting' || phase === 'uploading' || phase === 'completing'
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    // 그래도 닫으면 중단을 보낸다(언마운트 정리는 창 닫기·새로고침에는 돌지 않는다)
    // 완료 요청을 보내는 중(completing)이면 중단하지 않는다 (끝나 가는 업로드를 지우지 않게)
    const leave = () => {
      const id = videoIdRef.current
      if (id != null && phase !== 'completing') uploadsApi.abortOnUnload(id)
    }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('pagehide', leave)
    }
  }, [busy, phase])

  // 화면을 떠나면(다른 메뉴로 이동) 올리던 조각을 정리한다
  useEffect(
    () => () => {
      void discard()
    },
    [discard],
  )

  return { phase, loaded, etaSec, begin, stop, restart }
}
