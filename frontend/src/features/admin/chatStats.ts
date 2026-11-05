/** 챗봇 품질 통계 화면의 계산·표시 도우미 */

import type { ChatStats } from '@/api/types'

/** chat_logs.intent → 화면 이름. 모르는 값은 그대로 보여 준다 */
export const INTENT_LABELS: Record<string, string> = {
  QUESTION: '질문',
  SCENE_NOW: '지금 장면 설명',
  SEEK_SCENE: '장면 찾기',
  SEEK_TIME: '시각 이동',
  SETTING: '설정 바꾸기',
  ACTION: '영상 조작',
  SEARCH_VIDEO: '영상 검색',
  RECAP: '지금까지 줄거리',
  UNKNOWN: '못 알아들음',
}
export const intentLabel = (i: string) => INTENT_LABELS[i] ?? i

/** 분류 시간 목표 (CTL-03: p95 1.5초) */
export const INTENT_P95_TARGET_MS = 1500

/** 짧은 시간: 3 → "3ms", 1480 → "1.48초", null → "–" */
export function formatMs(ms: number | null): string {
  if (ms == null) return '–'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}초`
}

/** 영상 시점: 250000 → "4:10", 3723000 → "1:02:03" */
export function formatVideoTime(ms: number | null): string {
  if (ms == null) return '–'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** "2026-11-04 14:00" → "11-04 14:00" */
export const formatShortDateTime = (s: string) => s.slice(5)

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole)

/** API 값으로 화면에서 더 계산하는 값들 */
export function deriveChatStats(d: ChatStats) {
  const a = d.answer
  const unknown = d.byIntent.find((i) => i.intent === 'UNKNOWN')?.count ?? 0
  const slowest = d.byIntent.reduce<{ intent: string; ms: number } | null>(
    (acc, i) =>
      i.intentP95Ms != null && (acc == null || i.intentP95Ms > acc.ms)
        ? { intent: i.intent, ms: i.intentP95Ms }
        : acc,
    null,
  )
  const question = a.byIntent.find((i) => i.intent === 'QUESTION')
  const direct = a.questions - a.notAnsweredDirectly
  const nowhere = a.notAnsweredDirectly - a.futureOffered
  const seekFound = d.seek.keyword + (d.seek.rag ?? 0) + d.seek.llm
  return {
    unknown,
    unknownRate: ratio(unknown, d.inputs),
    slowest,
    question,
    direct,
    directRate: ratio(direct, a.questions),
    /** 물었지만 듣지 않음 */
    offeredDeclined: a.futureOffered - a.futureChosen,
    nowhere,
    seekFound,
    seekFoundRate: ratio(seekFound, d.seek.total),
  }
}
