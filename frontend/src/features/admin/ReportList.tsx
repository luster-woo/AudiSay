import { Link } from 'react-router-dom'
import { cn } from '@/components/ui/cn'
import { formatClock } from '@/utils/time'
import { formatReportedAt, REASON_BAR, REASON_LABELS, type ReportGroup } from './reports'

export interface ReportListProps {
  groups: ReportGroup[]
  selectedLineId: number | null
}

/** 신고 목록 (왼쪽, Figma 한 줄 76px). 한 줄이 해설 문장 하나이고, 누르면 오른쪽에 그 문장을 연다 */
export function ReportList({ groups, selectedLineId }: ReportListProps) {
  return (
    <ul>
      {groups.map((g) => {
        const r = g.first
        const selected = g.lineId === selectedLineId
        return (
          <li key={g.lineId}>
            <Link
              to={`/admin/reports/${r.reportId}`}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'relative flex h-[5.0667rem] items-start gap-3 px-[1.6rem] pt-[0.8rem]',
                selected ? 'bg-navy text-cream focus-visible:bg-navy-deep' : 'text-ink',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-[0.8rem] left-0 h-[3.4667rem] w-[0.2667rem]',
                  REASON_BAR[r.reason],
                )}
              />
              <span className="min-w-0 flex-1 leading-snug">
                <span className="block truncate text-[0.9333rem] font-bold">{r.videoTitle}</span>
                <span
                  className={cn(
                    'block truncate text-[0.8667rem]',
                    selected ? 'opacity-85' : 'text-ink-muted',
                  )}
                >
                  {formatClock(r.lineStartMs)} · {r.currentText}
                </span>
                <span
                  className={cn('block text-[0.8rem]', selected ? 'opacity-75' : 'text-ink-muted')}
                >
                  {REASON_LABELS[r.reason]} · {formatReportedAt(r.createdAt)}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-yellow px-[0.6rem] text-[0.8rem] leading-[1.3333rem] font-bold text-navy">
                <span aria-hidden="true">신고 {g.count}</span>
                <span className="sr-only">신고 {g.count}건</span>
              </span>
              {/* 줄 사이 구분선은 글자 폭만큼 (Figma) */}
              {!selected && (
                <span
                  aria-hidden="true"
                  className="absolute right-[1.6rem] bottom-0 left-[1.6rem] border-b border-line"
                />
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
