import { adminApi } from '@/api/admin'
import { formatAdminDateTime } from './format'
import { REPORT_REASON_LABELS } from '@/features/report/reasons'
import type { AdminReport, ReportReason, ReportStatus } from '@/api/types'

/** 신고 사유 이름: 사용자 신고 창과 같다 */
export const REASON_LABELS: Record<ReportReason, string> = REPORT_REASON_LABELS

export const STATUS_LABELS: Record<ReportStatus, string> = {
  PENDING: '처리 전',
  RESOLVED: '처리 완료',
  REJECTED: '반려',
}

/** 목록 왼쪽 띠 색. 색만으로 구분하지 않고 사유 글자도 함께 보여 준다 */
export const REASON_BAR: Record<ReportReason, string> = {
  WRONG: 'bg-danger',
  MISSING: 'bg-yellow',
  OVERLAP: 'bg-line',
  OTHER: 'bg-line',
}

/** 같은 해설 문장에 들어온 신고 묶음 (명세: 같은 문장 = 같은 건). 목록 한 줄 = 문장 하나 */
export interface ReportGroup {
  lineId: number
  /** 대표 신고 (가장 오래된 것). 주소 /admin/reports/:reportId 에 쓴다 */
  first: AdminReport
  /** 이 상태(처리 전 등)의 같은 문장 신고들, 오래된 순 */
  reports: AdminReport[]
  /** 이 상태의 신고 수. 다른 상태(이미 처리된 것)는 세지 않는다 */
  count: number
  /** 목록에 보이는 날짜. 처리 전은 가장 오래된 신고 일시(기다린 시간), 처리된 건은 가장 최근 처리 일시 */
  shownAt: string
}

/** 기본은 명세(ADM-01)대로 오래 기다린 신고부터 */
export type ReportSort = 'oldest' | 'most'

/** 서버 한 번 최대 50건 */
const MAX_SIZE = 50

/** 처리된 신고(완료·반려)는 최근 이만큼의 쪽(쪽마다 50건)만 받는다. 기록은 계속 쌓여 전부 받으면 요청이 끝없이 늘어난다 */
export const HANDLED_PAGES = 4
/** 쪽을 한 번에 이만큼씩 받는다 (수십 개를 동시에 보내 서버와 화면이 느려지지 않게) */
const CONCURRENT = 4

/**
 * 한 상태의 신고를 받는다. 서버는 신고 한 건씩 쪽으로 나눠 주므로(오래된 순), 쪽마다 묶으면 같은 문장이
 * 여러 줄로 갈라진다. 받은 뒤 화면에서 문장 단위로 묶는다.
 * - 처리 전: 모두 받는다 (처리할 일이라 다 보여야 하고, 처리하면 줄어든다)
 * - 처리 완료·반려: 최근 HANDLED_PAGES 쪽(200건)만 받는다
 */
export async function fetchAllReports(status: ReportStatus): Promise<AdminReport[]> {
  const first = await adminApi.reports({ status, page: 0, size: MAX_SIZE })
  const total = first.page.totalPages
  const from = status === 'PENDING' ? 1 : Math.max(1, total - HANDLED_PAGES)
  const pages = Array.from({ length: Math.max(0, total - from) }, (_, i) => from + i)
  const rest = []
  for (let i = 0; i < pages.length; i += CONCURRENT) {
    rest.push(
      ...(await Promise.all(
        pages
          .slice(i, i + CONCURRENT)
          .map((page) => adminApi.reports({ status, page, size: MAX_SIZE })),
      )),
    )
  }
  // 처리된 신고가 많아 최근 쪽만 받았으면 첫 쪽(가장 오래된 것)은 빼고 최근 것만 보인다
  const head = status === 'PENDING' || total <= HANDLED_PAGES + 1 ? [first] : []
  const seen = new Set<number>()
  return [...head, ...rest]
    .flatMap((p) => p.content)
    .filter((r) => !seen.has(r.reportId) && seen.add(r.reportId))
}

/** 신고를 문장(lineId) 단위로 묶는다 */
export function groupReports(reports: AdminReport[], sort: ReportSort): ReportGroup[] {
  const byLine = new Map<number, AdminReport[]>()
  for (const r of reports) {
    const list = byLine.get(r.lineId)
    if (list) list.push(r)
    else byLine.set(r.lineId, [r])
  }
  const groups = [...byLine.values()].map((list): ReportGroup => {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const handled = sorted
      .map((r) => r.handledAt)
      .filter((d): d is string => !!d)
      .sort()
    return {
      lineId: sorted[0].lineId,
      first: sorted[0],
      reports: sorted,
      count: sorted.length,
      shownAt: handled.at(-1) ?? sorted[0].createdAt,
    }
  })
  return groups.sort((a, b) =>
    sort === 'most' && a.count !== b.count
      ? b.count - a.count
      : a.first.createdAt.localeCompare(b.first.createdAt),
  )
}

/** 서버 UTC ISO → 한국 시간 "2026-10-22 09:12" (관리자 표 공통 형식, format.ts) */
export function formatReportedAt(iso: string): string {
  return formatAdminDateTime(iso)
}
