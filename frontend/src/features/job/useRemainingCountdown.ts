import { useEffect, useState } from 'react'

const TICK_MS = 1_000
/** 서버가 준 값이 화면에서 세던 값보다 이만큼(초)까지 많으면 숫자를 되올리지 않고 그대로 센다 */
export const BOUNCE_SEC = 5

type Anchor = { sec: number; at: number }

/** 새 서버 값이 오면 다시 맞춘다. 조금 많을 때만 세던 것을 이어 간다(37 → 22 → 24처럼 되올라가지 않게) */
export function nextAnchor(
  old: Anchor | null,
  sec: number | null | undefined,
  at: number,
): Anchor | null {
  if (sec == null) return null
  if (old) {
    const local = old.sec - (at - old.at) / 1000
    if (sec > local && sec - local <= BOUNCE_SEC) return old
  }
  return { sec, at }
}

export function countdownAt(anchor: Anchor | null, now: number): number | null {
  if (!anchor) return null
  return Math.max(0, Math.ceil(anchor.sec - (now - anchor.at) / 1000))
}

/**
 * 남은 시간(초)을 1초마다 1씩 줄여 보여 준다.
 * 서버는 15초마다·단계가 바뀔 때만 남은 시간을 주므로(JobRemainingTicker) 그 사이는 화면에서 센다.
 * 새 값이 오면 맞추고, 0이 되면 0에서 멈춘다(화면은 "거의 다 됐어요"). 서버 값이 null이면 null.
 * 시각(Date.now)은 렌더 중에 읽지 않고 타이머 안에서만 읽는다.
 */
export function useRemainingCountdown(
  sec: number | null | undefined,
  running: boolean,
): number | null {
  const [anchor, setAnchor] = useState<Anchor | null>(() => nextAnchor(null, sec, Date.now()))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setTimeout(() => {
      const t = Date.now()
      setNow(t)
      setAnchor((old) => nextAnchor(old, sec, t))
    }, 0)
    return () => window.clearTimeout(id)
  }, [sec])

  const ticking = running && anchor != null
  useEffect(() => {
    if (!ticking) return
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [ticking])

  return running ? countdownAt(anchor, now) : (sec ?? null)
}
