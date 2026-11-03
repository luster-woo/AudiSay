/** AI 사용량 통계 화면의 계산·표시 도우미 */

import type { AiUsageDaily } from '@/api/types'

/** ai_call_logs.purpose → 화면 이름. 모르는 값은 그대로 보여 준다 */
export const PURPOSE_LABELS: Record<string, string> = {
  DESCRIBE: '해설 생성',
  SUMMARY: '30초 요약',
  CHAPTER: '장면 목차',
  QUESTION: '질문 답변',
  INTENT: '발화 분석',
  SEEK: '장면 찾기',
  STT: '음성 받아쓰기',
  TTS: '해설 음성',
  GUIDE_TTS: '안내 목소리',
  VERIFY: '인증 서류 판정',
}
export const purposeLabel = (p: string) => PURPOSE_LABELS[p] ?? p

/** 자체 서버(H200)에서 돌린 모델. 크레딧이 들지 않는다 */
export const isSelfHosted = (model: string) =>
  model.startsWith('h200:') || model.startsWith('supertonic')

const nf = new Intl.NumberFormat('ko-KR')
/** 1234567 → "1,234,567" */
export const formatInt = (n: number) => nf.format(Math.round(n))

/** 크레딧: 소수 한 자리까지 */
export const formatCredits = (n: number) => nf.format(Math.round(n * 10) / 10)

/** 0.021 → "2.1%" */
export const formatRate = (r: number) => `${(r * 100).toFixed(1)}%`

/** 밀리초 → "0.9초" / "21초" / "1분 20초" */
export function formatLatency(ms: number | null): string {
  if (ms == null) return '–'
  const sec = ms / 1000
  if (sec < 10) return `${sec.toFixed(1)}초`
  if (sec < 60) return `${Math.round(sec)}초`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s ? `${m}분 ${s}초` : `${m}분`
}

/** 큰 수를 짧게: 3820000 → "382만", 1240 → "1,240" */
export function formatCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e8) return `${trim(n / 1e8)}억`
  if (abs >= 1e4) return `${trim(n / 1e4)}만`
  return nf.format(Math.round(n * 10) / 10)
}
const trim = (v: number) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))

/* ── 날짜 (KST 기준, YYYY-MM-DD) ── */

export const MAX_RANGE_DAYS = 92

/** 지금 시각의 KST 날짜 */
export function todayKst(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
}

/** "2026-10-05" + (-7) → "2026-09-28" */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d + days)
  return new Date(t).toISOString().slice(0, 10)
}

/** 양끝을 포함한 날짜 수. from 이 to 보다 늦으면 0 이하 */
export function rangeDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** 기간이 잘못됐으면 이유, 괜찮으면 null */
export function validateRange(from: string, to: string): string | null {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return '날짜를 YYYY-MM-DD 로 적어 주세요.'
  const days = rangeDays(from, to)
  if (days <= 0) return '시작 날짜가 끝 날짜보다 늦어요.'
  if (days > MAX_RANGE_DAYS) return `조회 기간은 최대 ${MAX_RANGE_DAYS}일이에요. (지금 ${days}일)`
  return null
}

export type RangePreset = 'today' | '7d' | '30d' | 'month'
export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: '오늘' },
  { value: '7d', label: '최근 7일' },
  { value: '30d', label: '최근 30일' },
  { value: 'month', label: '이번 달' },
]

export function presetRange(preset: RangePreset, today = todayKst()): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '30d':
      return { from: addDays(today, -29), to: today }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today }
  }
}

/** "2026-10-05" → "10. 5." (표·막대 라벨) */
export function formatDayLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}. ${d}.`
}

/** 2026-10-05 → "10월 5일" (툴팁·낭독) */
export function formatDayLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

/* ── 날짜별 그림에 보여 줄 값 ── */

export type DailyMetric = 'credits' | 'calls' | 'tokens'

export const DAILY_METRICS: { value: DailyMetric; label: string }[] = [
  { value: 'credits', label: '크레딧' },
  { value: 'calls', label: '호출 수' },
  { value: 'tokens', label: '토큰' },
]

/** 막대 하나의 값 */
export function metricValue(d: AiUsageDaily, metric: DailyMetric): number {
  switch (metric) {
    case 'credits':
      return d.estimatedCredits
    case 'calls':
      return d.calls
    case 'tokens':
      return d.inputTokens + d.outputTokens
  }
}

/** 툴팁·표에 쓰는 값 표기 */
export function formatMetric(value: number, metric: DailyMetric): string {
  return metric === 'credits' ? formatCredits(value) : formatInt(value)
}
