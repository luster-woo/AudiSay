/** 영상 내 위치(ms) → "2:14" / "1:02:14" (화면 표시용) */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

/** 초 → "4분 42초" / "1시간 2분" (낭독용, aria-label 과 announce 에 사용) */
export function formatDurationSpoken(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts: string[] = []
  if (h) parts.push(`${h}시간`)
  if (m) parts.push(`${m}분`)
  if (s || parts.length === 0) parts.push(`${s}초`)
  return parts.join(' ')
}

/** ms → 낭독용. 재생바 위치 읽어 줄 때 */
export const formatPositionSpoken = (ms: number) => formatDurationSpoken(ms / 1000)

/** 서버 UTC ISO → 한국 시간 "10. 24." / "2026. 10. 24. 09:12" */
export function formatDateKst(iso: string, withTime = false): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: withTime ? 'numeric' : undefined,
    month: 'numeric',
    day: 'numeric',
    hour: withTime ? '2-digit' : undefined,
    minute: withTime ? '2-digit' : undefined,
    hour12: false,
  }).format(d)
}