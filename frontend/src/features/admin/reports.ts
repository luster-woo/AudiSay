import type { AdminReport, ReportReason, ReportStatus } from '@/api/types'

export const REASON_LABELS: Record<ReportReason, string> = {
  WRONG: '틀린 내용',
  MISSING: '빠짐',
  OVERLAP: '대사와 겹침',
  OTHER: '기타',
}

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

/** 같은 해설 문장에 들어온 신고 묶음. 목록 한 줄 = 문장 하나 */
export interface ReportGroup {
  lineId: number
  /** 대표 신고 (가장 오래된 것). 주소 /admin/reports/:reportId 에 쓴다 */
  first: AdminReport
  reports: AdminReport[]
  /** 이 페이지 밖의 신고까지 센 수 */
  count: number
}

/** 기본은 명세(ADM-01)대로 오래 기다린 신고부터 */
export type ReportSort = 'oldest' | 'most'

/** 서버는 신고 단위로 오래된 순으로 주므로, 화면에서 문장 단위로 묶는다 */
export function groupReports(reports: AdminReport[], sort: ReportSort): ReportGroup[] {
  const byLine = new Map<number, AdminReport[]>()
  for (const r of reports) {
    const list = byLine.get(r.lineId)
    if (list) list.push(r)
    else byLine.set(r.lineId, [r])
  }
  const groups = [...byLine.values()].map((list): ReportGroup => {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return {
      lineId: sorted[0].lineId,
      first: sorted[0],
      reports: sorted,
      count: Math.max(sorted.length, ...sorted.map((r) => r.sameLineReportCount)),
    }
  })
  return groups.sort((a, b) =>
    sort === 'most' && a.count !== b.count
      ? b.count - a.count
      : a.first.createdAt.localeCompare(b.first.createdAt),
  )
}

/** 서버 UTC ISO → 한국 시간 "10. 22. 09:12" (관리자 목록용, 연도 생략) */
export function formatReportedAt(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}
