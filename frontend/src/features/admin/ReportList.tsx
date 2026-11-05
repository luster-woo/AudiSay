import { Link } from 'react-router-dom'
import type { ReportStatus } from '@/api/types'
import { cn } from '@/components/ui/cn'
import { formatClock } from '@/utils/time'
import { formatReportedAt, REASON_BAR, REASON_LABELS, type ReportGroup } from './reports'

export interface ReportListProps {
  groups: ReportGroup[]
  status: ReportStatus
}

/**
 * 신고 게시판 (표). 한 줄이 해설 문장 하나(같은 문장 신고 묶음)이고, 영상 제목 링크로 상세를 연다.
 * 줄 어디를 눌러도 열리게 링크를 줄 전체로 넓히되, 낭독기에는 링크 하나로만 읽힌다.
 */
export function ReportList({ groups, status }: ReportListProps) {
  const pending = status === 'PENDING'
  const query = pending ? '' : `?status=${status}`
  return (
    <table className="w-full table-fixed border-collapse text-left text-[0.9333rem]">
      <caption className="sr-only">신고 목록. 같은 문장에 들어온 신고는 한 줄로 묶었어요.</caption>
      <colgroup>
        {/* 모든 칸을 비율로 나눠 화면이 넓어져도 칸 사이가 고르게 벌어진다. 넘치는 글은 … 로 줄인다 */}
        <col className="w-[26%]" />
        <col className="w-[40%]" />
        <col className="w-[12%]" />
        <col className="w-[8%]" />
        <col className="w-[14%]" />
      </colgroup>
      <thead className="border-b-2 border-line text-[0.8667rem] text-ink-muted">
        <tr>
          <th scope="col" className="px-4 py-2.5 font-bold">
            영상
          </th>
          <th scope="col" className="px-4 py-2.5 font-bold">
            신고된 문장
          </th>
          <th scope="col" className="px-4 py-2.5 font-bold">
            사유
          </th>
          <th scope="col" className="px-4 py-2.5 text-center font-bold">
            신고 수
          </th>
          <th scope="col" className="px-4 py-2.5 font-bold">
            {pending ? '첫 신고' : '처리일'}
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const r = g.first
          // 같은 문장이라도 사유가 여럿일 수 있다: "틀린 내용 외 1"
          const reasons = [...new Set(g.reports.map((x) => x.reason))]
          const reason =
            reasons.length > 1
              ? `${REASON_LABELS[r.reason]} 외 ${reasons.length - 1}`
              : REASON_LABELS[r.reason]
          return (
            <tr
              key={g.lineId}
              className="relative border-b border-line hover:bg-cream has-[a:focus-visible]:bg-yellow-soft"
            >
              <td className="px-4 py-3.5">
                <span
                  aria-hidden="true"
                  className={cn('absolute inset-y-2 left-0 w-[0.2667rem]', REASON_BAR[r.reason])}
                />
                <Link
                  to={`/admin/reports/${r.reportId}${query}`}
                  title={r.videoTitle}
                  className="block truncate font-bold text-ink outline-none before:absolute before:inset-0 before:content-['']"
                >
                  {r.videoTitle}
                </Link>
              </td>
              <td className="truncate px-4 py-3.5 text-ink-muted" title={r.currentText}>
                <span className="tabular-nums">{formatClock(r.lineStartMs)}</span> · {r.currentText}
              </td>
              <td className="truncate px-4 py-3.5" title={reason}>
                {reason}
              </td>
              <td className="px-4 py-3.5 text-center font-bold tabular-nums">{g.count}건</td>
              <td className="truncate px-4 py-3.5 text-ink-muted tabular-nums">
                {formatReportedAt(g.shownAt)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
