import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Playback } from '@/api/types'

/** 영상 소스(업로드 <video> / 유튜브 IFrame)를 같은 모양으로 다루는 손잡이 */
export interface PlayerControls {
  play: () => void
  pause: () => void
  seek: (ms: number) => void
  /** 0 ~ 100 */
  setVolume: (v: number) => void
}

export interface PlayerState {
  ready: boolean
  playing: boolean
  ended: boolean
  currentMs: number
  durationMs: number
}

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void
  }
}

let ytApiPromise: Promise<void> | null = null
/** 유튜브 IFrame API 스크립트를 한 번만 불러온다 */
/**
 * 유튜브 자막(자동 생성 포함)을 끈다. 자막은 우리 해설 데이터(screenTexts)로 읽기 때문이다.
 * playerVars 의 cc_load_policy 만으로는 유튜브 계정에서 '항상 자막 켜기'를 켠 사용자나
 * 자막이 기본으로 켜지는 영상에서 자막이 그대로 보여서, 플레이어의 자막 모듈 자체를 내린다 (비공식 API).
 */
function unloadCaptions(player: YT.Player) {
  const p = player as unknown as { unloadModule?: (name: string) => void }
  try {
    p.unloadModule?.('captions')
    p.unloadModule?.('cc')
  } catch {
    /* 모듈이 없거나 이미 내려간 상태 */
  }
}

function loadYoutubeApi(): Promise<void> {
  if (typeof YT !== 'undefined' && YT.Player) return Promise.resolve()
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    document.head.appendChild(s)
  })
  return ytApiPromise
}

const POLL_MS = 250

/**
 * 재생 소스 하나를 만들고 상태(시각·재생 중)와 조작 함수를 준다.
 * 업로드 영상은 videoRef 에 <video> 를, 유튜브는 ytHostRef 에 <div> 를 달아 준다.
 * 둘 다 브라우저 기본 컨트롤은 쓰지 않는다 — 재생바는 우리가 만든다 (원칙 5장).
 */
export function usePlayerSource(
  playback: Playback | undefined,
  fallbackDurationSec: number,
): {
  videoRef: RefObject<HTMLVideoElement | null>
  ytHostRef: RefObject<HTMLDivElement | null>
  state: PlayerState
  controls: PlayerControls
} {
  const videoRef = useRef<HTMLVideoElement>(null)
  const ytHostRef = useRef<HTMLDivElement>(null)
  const ytRef = useRef<YT.Player | null>(null)
  const [state, setState] = useState<PlayerState>({
    ready: false,
    playing: false,
    ended: false,
    currentMs: 0,
    durationMs: fallbackDurationSec * 1000,
  })
  const patch = useCallback((p: Partial<PlayerState>) => setState((s) => ({ ...s, ...p })), [])

  const sourceType = playback?.sourceType
  const playbackUrl = playback?.playbackUrl
  const youtubeVideoId = playback?.youtubeVideoId

  // ── 업로드 영상: <video> 이벤트로 상태를 받는다 ──
  useEffect(() => {
    if (sourceType !== 'UPLOAD') return
    const el = videoRef.current
    if (!el || !playbackUrl) return
    const onMeta = () =>
      patch({ ready: true, durationMs: Math.round((el.duration || fallbackDurationSec) * 1000) })
    const onTime = () => patch({ currentMs: Math.round(el.currentTime * 1000) })
    const onPlay = () => patch({ playing: true, ended: false })
    const onPause = () => patch({ playing: false })
    const onEnded = () => patch({ playing: false, ended: true })
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('seeked', onTime)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    if (el.readyState >= 1) onMeta()
    return () => {
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('seeked', onTime)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
    }
  }, [sourceType, playbackUrl, fallbackDurationSec, patch])

  // ── 유튜브: IFrame API 플레이어를 만들고 250ms 마다 시각을 읽는다 ──
  useEffect(() => {
    if (sourceType !== 'YOUTUBE' || !youtubeVideoId) return
    const host = ytHostRef.current
    if (!host) return
    let cancelled = false
    let poll: ReturnType<typeof setInterval> | undefined
    const mount = document.createElement('div')
    host.replaceChildren(mount)

    void loadYoutubeApi().then(() => {
      if (cancelled) return
      const player = new YT.Player(mount, {
        videoId: youtubeVideoId,
        width: '100%',
        height: '100%',
        playerVars: {
          controls: 0,
          disablekb: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          // 유튜브 자막(자동 생성 포함)은 끄고 시작한다. 자막은 우리 해설 데이터(screenTexts)를 설정대로 읽는다.
          // 3 = 비공식 값. 이것만으로 안 꺼지는 경우가 있어 onReady/재생 시작 때 unloadCaptions 로 모듈도 내린다
          cc_load_policy: 3 as unknown as YT.ClosedCaptionsLoadPolicy,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (cancelled) return
            // 유튜브 iframe 에 Tab 으로 들어가지 않게 (영상 상자는 aria-hidden, 조작은 바깥 컨트롤)
            player.getIframe()?.setAttribute('tabindex', '-1')
            unloadCaptions(player)
            patch({
              ready: true,
              durationMs: Math.round((player.getDuration() || fallbackDurationSec) * 1000),
            })
            poll = setInterval(() => {
              patch({ currentMs: Math.round(player.getCurrentTime() * 1000) })
            }, POLL_MS)
          },
          onStateChange: (e) => {
            const s = e.data
            // 자막 모듈은 재생이 시작될 때 다시 올라올 수 있어 그때마다 내린다
            if (s === YT.PlayerState.PLAYING) {
              unloadCaptions(player)
              patch({ playing: true, ended: false })
            } else if (s === YT.PlayerState.ENDED) patch({ playing: false, ended: true })
            else if (s === YT.PlayerState.PAUSED) patch({ playing: false })
          },
        },
      })
      ytRef.current = player
    })
    return () => {
      cancelled = true
      if (poll) clearInterval(poll)
      try {
        ytRef.current?.destroy()
      } catch {
        /* 이미 지워진 iframe */
      }
      ytRef.current = null
      host.replaceChildren()
    }
  }, [sourceType, youtubeVideoId, fallbackDurationSec, patch])

  // 조작 함수는 호출 시점에 ref 를 읽으므로 sourceType 이 바뀔 때만 새로 만든다
  const controls = useMemo<PlayerControls>(
    () => ({
      play: () => {
        if (sourceType === 'YOUTUBE') ytRef.current?.playVideo()
        else void videoRef.current?.play().catch(() => undefined)
      },
      pause: () => {
        if (sourceType === 'YOUTUBE') ytRef.current?.pauseVideo()
        else videoRef.current?.pause()
      },
      seek: (ms) => {
        const clamped = Math.max(0, ms)
        if (sourceType === 'YOUTUBE') ytRef.current?.seekTo(clamped / 1000, true)
        else if (videoRef.current) videoRef.current.currentTime = clamped / 1000
        patch({ currentMs: clamped, ended: false })
      },
      setVolume: (v) => {
        if (sourceType === 'YOUTUBE') ytRef.current?.setVolume(v)
        else if (videoRef.current) videoRef.current.volume = Math.min(1, Math.max(0, v / 100))
      },
    }),
    [sourceType, patch],
  )

  return { videoRef, ytHostRef, state, controls }
}
