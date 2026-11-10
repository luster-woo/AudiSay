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
  /** 재생할 수 없을 때 사용자에게 알릴 이유 (없으면 null) */
  error: string | null
}

/** 유튜브 IFrame 오류 코드 → 안내 문구 */
export function youtubeErrorMessage(code: number): string {
  if (code === 100) return '유튜브에서 영상이 지워졌거나 비공개로 바뀌어 재생할 수 없어요.'
  if (code === 101 || code === 150)
    return '영상 주인이 다른 사이트에서 재생하지 못하게 막아 두어 재생할 수 없어요.'
  return '유튜브 영상을 재생할 수 없어요. 잠시 뒤에 다시 시도해 주세요.'
}
export const UPLOAD_ERROR_MESSAGE = '영상 파일을 재생할 수 없어요. 잠시 뒤에 다시 시도해 주세요.'
export const YOUTUBE_API_ERROR_MESSAGE = '유튜브 플레이어를 불러오지 못했어요. 새로고침해 주세요.'

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
  ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    // 스크립트를 못 받으면(차단·오프라인) 다음에 다시 시도할 수 있게 비운다
    s.onerror = () => {
      ytApiPromise = null
      s.remove()
      reject(new Error('youtube api'))
    }
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
  /**
   * 유튜브를 한 번도 재생하지 않은 상태(시작 전·대기)에서 옮긴 위치. 이 상태의 seekTo 는 재생을 시작해 버리고,
   * 곧바로 멈추면 이동이 무시돼 시각이 0으로 돌아온다. 그래서 위치만 기억해 두고 재생할 때 그 자리부터 튼다
   */
  const ytPendingSeekRef = useRef<number | null>(null)
  const [state, setState] = useState<PlayerState>({
    ready: false,
    playing: false,
    ended: false,
    currentMs: 0,
    durationMs: fallbackDurationSec * 1000,
    error: null,
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
    const onError = () => patch({ playing: false, error: UPLOAD_ERROR_MESSAGE })
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('error', onError)
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
      el.removeEventListener('error', onError)
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

    // 예비: inert(onReady) 가 안 먹는 브라우저에서 포커스가 iframe 으로 들어가면 직전 조작 요소로 돌려보낸다.
    // (영상 상자는 aria-hidden 이라 낭독기가 "문서, 알 수 없음…"만 읽고 사용자는 위치를 잃는다)
    let lastFocused: HTMLElement | null = null
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target
      if (t instanceof HTMLElement && !host.contains(t)) lastFocused = t
    }
    // 포커스가 다른 origin 의 iframe 으로 들어가면 window 가 blur 되고 activeElement 가 그 iframe 이 된다
    const onWindowBlur = () => {
      setTimeout(() => {
        const iframe = ytRef.current?.getIframe?.()
        if (iframe && document.activeElement === iframe) lastFocused?.focus({ preventScroll: true })
      }, 0)
    }
    document.addEventListener('focusin', onFocusIn)
    window.addEventListener('blur', onWindowBlur)

    void loadYoutubeApi().then(
      () => {
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
              // 유튜브 iframe 에 포커스가 들어가지 않게. 유튜브는 재생·멈춤·이동 때마다 자기 iframe 으로 포커스를
              // 가져가는데, inert 면 크롬이 프레임 안쪽까지 포커스 불가로 만들어 그 요청을 거부한다 (영상 상자는
              // aria-hidden, 조작은 바깥 컨트롤). 클릭으로 영상을 멈추는 것도 함께 막히지만 재생 버튼이 그 역할을 한다
              const iframe = player.getIframe()
              iframe?.setAttribute('tabindex', '-1')
              if (iframe) iframe.inert = true
              unloadCaptions(player)
              patch({
                ready: true,
                durationMs: Math.round((player.getDuration() || fallbackDurationSec) * 1000),
              })
              poll = setInterval(() => {
                // 재생 전에 옮겨 둔 위치가 있으면 그 시각을 그대로 보인다 (플레이어는 아직 0)
                if (ytPendingSeekRef.current != null) return
                // 재생 전에 옮겨 둔 위치가 있으면 그 시각을 그대로 보인다 (플레이어는 아직 0)
              if (ytPendingSeekRef.current != null) return
              patch({ currentMs: Math.round(player.getCurrentTime() * 1000) })
              }, POLL_MS)
            },
            onStateChange: (e) => {
              const s = e.data
              // 자막 모듈은 재생이 시작될 때 다시 올라올 수 있어 그때마다 내린다
              if (s === YT.PlayerState.PLAYING) {
                ytPendingSeekRef.current = null
                ytPendingSeekRef.current = null
              unloadCaptions(player)
                patch({ playing: true, ended: false })
              } else if (s === YT.PlayerState.ENDED) patch({ playing: false, ended: true })
              else if (s === YT.PlayerState.PAUSED) patch({ playing: false })
            },
            // 퍼가기 막힘(101·150)·지워짐(100)·잘못된 영상(2·5): 재생 버튼을 막고 이유를 알린다
            onError: (e) => {
              if (cancelled) return
              patch({ playing: false, error: youtubeErrorMessage(e.data) })
            },
          },
        })
        ytRef.current = player
      },
      () => {
        if (!cancelled) patch({ error: YOUTUBE_API_ERROR_MESSAGE })
      },
    )
    return () => {
      cancelled = true
      document.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('blur', onWindowBlur)
      if (poll) clearInterval(poll)
      try {
        ytRef.current?.destroy()
      } catch {
        /* 이미 지워진 iframe */
      }
      ytRef.current = null
      ytPendingSeekRef.current = null
      host.replaceChildren()
    }
  }, [sourceType, youtubeVideoId, fallbackDurationSec, patch])

  // 조작 함수는 호출 시점에 ref 를 읽으므로 sourceType 이 바뀔 때만 새로 만든다
  const controls = useMemo<PlayerControls>(
    () => ({
      play: () => {
        if (sourceType === 'YOUTUBE') {
          const yt = ytRef.current
          const pending = ytPendingSeekRef.current
          // 재생 전에 옮겨 둔 위치부터 튼다 (시작 전 상태의 seekTo 는 그 자리에서 재생을 시작한다)
          if (yt && pending != null) yt.seekTo(pending / 1000, true)
          else yt?.playVideo()
        } else void videoRef.current?.play().catch(() => undefined)
      },
      pause: () => {
        if (sourceType === 'YOUTUBE') ytRef.current?.pauseVideo()
        else videoRef.current?.pause()
      },
      seek: (ms) => {
        const clamped = Math.max(0, ms)
        if (sourceType === 'YOUTUBE') {
          const yt = ytRef.current
          // 유튜브 seekTo 는 끝남·대기 상태에서 부르면 재생까지 시작한다. 이동만 하고 멈춘 상태는 그대로 둔다
          const s = yt?.getPlayerState()
          const notStarted =
            !yt ||
            s == null ||
            s === YT.PlayerState.UNSTARTED ||
            s === YT.PlayerState.CUED ||
            ytPendingSeekRef.current != null
          if (notStarted) {
            // 한 번도 재생하지 않았으면 플레이어는 건드리지 않고 위치만 기억한다 (재생할 때 그 자리부터)
            ytPendingSeekRef.current = clamped
          } else {
            const wasPlaying = s === YT.PlayerState.PLAYING || s === YT.PlayerState.BUFFERING
            yt.seekTo(clamped / 1000, true)
            if (!wasPlaying) yt.pauseVideo()
          }
        } else if (videoRef.current) videoRef.current.currentTime = clamped / 1000
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
