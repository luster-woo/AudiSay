import { useEffect, useState, useSyncExternalStore } from 'react'
import analyzingImg from '@/assets/job/odi-analyzing.webp'
import analyzingStillImg from '@/assets/job/odi-analyzing-still.webp'
import askImg from '@/assets/tour/ask.webp'
import playImg from '@/assets/tour/play.webp'

type Phase = 'waiting' | 'running' | 'done' | 'failed'

// 끝나면 오디 포즈가 바뀐다: 완료 플레이 버튼 안기 · 실패 갸우뚱
const END_POSE: Record<'done' | 'failed', string> = { done: playImg, failed: askImg }

const PAUSED_KEY = 'jobMascotPaused'

// 기기의 '동작 줄이기' 설정. 바뀌면 바로 따른다 (테스트 환경처럼 matchMedia 가 없으면 꺼진 것으로 본다)
const REDUCE = '(prefers-reduced-motion: reduce)'
function subscribeReduce(onChange: () => void) {
  const query = window.matchMedia?.(REDUCE)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}
const useReducedMotion = () =>
  useSyncExternalStore(subscribeReduce, () => window.matchMedia?.(REDUCE).matches ?? false)

// 저장소를 막아 둔 브라우저(쿠키 전체 차단 등)에서는 localStorage 가 예외를 던진다. 그때는 기억하지 않는다
function readPaused() {
  try {
    return localStorage.getItem(PAUSED_KEY) === '1'
  } catch {
    return false
  }
}
function savePaused(paused: boolean) {
  try {
    localStorage.setItem(PAUSED_KEY, paused ? '1' : '0')
  } catch {
    /* 기억하지 못해도 이번 화면에서는 멈춘다 */
  }
}

/**
 * 움직이는 그림(약 1MB)은 화면이 다 뜬 뒤에 받는다. 처음부터 받으면 글꼴·JS 와 대역폭을 다퉈
 * 해설 만들기 화면 첫 로딩의 2/3 를 차지했다 (1,473KB 중 977KB). 그동안은 같은 포즈의 멈춘 그림(16KB)을 보여 준다.
 * 한 번 받은 뒤에는(다른 화면에 갔다 와도) 바로 움직이는 그림을 쓴다
 */
let animatedLoaded = false
function useAnimatedReady(wanted: boolean) {
  const [ready, setReady] = useState(animatedLoaded)
  useEffect(() => {
    if (!wanted || ready) return
    let cancelled = false
    let idleId: number | undefined
    let timerId: number | undefined
    const load = () => {
      const img = new Image()
      img.onload = () => {
        animatedLoaded = true
        if (!cancelled) setReady(true)
      }
      img.src = analyzingImg
    }
    // 글꼴까지 다 받은 뒤, 브라우저가 한가할 때 받기 시작한다 (requestIdleCallback 이 없는 Safari 는 잠깐 뒤에)
    const start = () => {
      if (cancelled) return
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(load, { timeout: 2000 })
      } else {
        timerId = window.setTimeout(load, 500)
      }
    }
    void (document.fonts?.ready ?? Promise.resolve()).then(start)
    return () => {
      cancelled = true
      if (idleId !== undefined) window.cancelIdleCallback(idleId)
      if (timerId !== undefined) window.clearTimeout(timerId)
    }
  }, [wanted, ready])
  return ready
}

/**
 * 해설 만들기 화면의 마스코트 오디. 장식이라 낭독기에 숨긴다.
 * 대기·진행 중엔 태블릿으로 영상을 보며 움직인다(움직이는 WebP).
 * 5초 넘게 저절로 움직이므로 그림을 눌러 멈출 수 있게 하고 고른 값을 기억한다 (WCAG 2.2.2).
 * 기기의 '동작 줄이기'가 켜져 있으면 처음부터 멈춘 그림만 보여 준다(버튼 아님).
 */
export function JobMascot({ phase }: { phase: Phase }) {
  const [paused, setPaused] = useState(readPaused)
  const reducedMotion = useReducedMotion()
  // 멈춰 두었거나 동작 줄이기가 켜져 있으면 움직이는 그림은 받지 않는다
  const animatedReady = useAnimatedReady(
    !paused && !reducedMotion && (phase === 'waiting' || phase === 'running'),
  )

  if (phase === 'done' || phase === 'failed') {
    return (
      <img
        src={END_POSE[phase]}
        alt=""
        aria-hidden="true"
        width={320}
        height={400}
        className="h-48 w-auto shrink-0"
      />
    )
  }

  if (reducedMotion) {
    return (
      <img
        src={analyzingStillImg}
        alt=""
        aria-hidden="true"
        width={336}
        height={288}
        className="h-48 w-auto shrink-0"
      />
    )
  }

  const toggle = () => {
    savePaused(!paused)
    setPaused(!paused)
  }

  // 그림 전체가 멈춤 버튼이다 (따로 ⏸/▶ 표시는 두지 않는다). 이름은 낭독기용으로 바뀐다
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={paused ? '캐릭터 움직임 켜기' : '캐릭터 움직임 멈추기'}
      className="shrink-0 cursor-pointer rounded-lg"
    >
      <img
        src={paused || !animatedReady ? analyzingStillImg : analyzingImg}
        alt=""
        width={336}
        height={288}
        className="h-48 w-auto"
      />
    </button>
  )
}
