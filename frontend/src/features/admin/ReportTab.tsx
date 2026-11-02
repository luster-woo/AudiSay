import { useEffect, useRef } from 'react'
import type { AdminReport } from '@/api/types'
import { formatClock } from '@/utils/time'
import { formatReportedAt, REASON_LABELS, STATUS_LABELS, type ReportGroup } from './reports'

export interface ReportTabProps {
  group: ReportGroup
  /** 같은 영상에서 신고가 들어온 다른 문장들 */
  otherLines: ReportGroup[]
  /** 처리 전 목록일 때만 고르고 처리할 수 있다 */
  editable: boolean
  selectedIds: Set<number>
  onSelectedChange: (ids: Set<number>) => void
  onRejectOne: (report: AdminReport) => void
  busy: boolean
}

/** 체크박스 (Figma 16px 남색). 관리자 화면은 작은 크기를 쓴다 */
const CHECK = 'size-4 min-h-0 shrink-0 cursor-pointer accent-navy'

/** 신고 탭: 이 문장에 들어온 신고들. 고른 신고만 아래 버튼으로 처리 완료·반려한다 */
export function ReportTab({
  group,
  otherLines,
  editable,
  selectedIds,
  onSelectedChange,
  onRejectOne,
  busy,
}: ReportTabProps) {
  const all = group.reports
  const allSelected = all.every((r) => selectedIds.has(r.reportId))
  const someSelected = !allSelected && all.some((r) => selectedIds.has(r.reportId))
  const otherCount = otherLines.reduce((sum, g) => sum + g.count, 0)
  const otherTimes = otherLines.map((g) => formatClock(g.first.lineStartMs)).join(', ')

  // indeterminate 는 DOM 프로퍼티로만 켤 수 있다
  const allRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someSelected
  }, [someSelected])

  const toggle = (id: number, on: boolean) => {
    const next = new Set(selectedIds)
    if (on) next.add(id)
    else next.delete(id)
    onSelectedChange(next)
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-[0.8667rem]">
        <p className="text-ink-muted">
          이 문장에 대한 신고 {group.count}건
          {otherCount > 0 && ` · 같은 영상의 다른 문장 신고 ${otherCount}건 (${otherTimes})`}
        </p>
        {editable && (
          <label className="flex cursor-pointer items-center gap-2 font-bold text-navy">
            <input
              ref={allRef}
              type="checkbox"
              checked={allSelected}
              onChange={(e) =>
                onSelectedChange(e.target.checked ? new Set(all.map((r) => r.reportId)) : new Set())
              }
              className={CHECK}
            />
            전체 선택
          </label>
        )}
      </div>

      <ul className="mt-[0.8667rem] space-y-[0.8667rem]">
        {all.map((r) => {
          const when = formatReportedAt(r.createdAt)
          const checkId = `report-${r.reportId}`
          return (
            <li
              key={r.reportId}
              className="flex gap-3 rounded-sm border border-line bg-paper px-4 py-[1.1333rem]"
            >
              {editable && (
                <input
                  id={checkId}
                  type="checkbox"
                  aria-label={`${REASON_LABELS[r.reason]} · ${when} · 회원 ${r.reporterId}`}
                  checked={selectedIds.has(r.reportId)}
                  onChange={(e) => toggle(r.reportId, e.target.checked)}
                  className={`${CHECK} mt-0.5`}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[0.8667rem]">
                    <label
                      htmlFor={editable ? checkId : undefined}
                      className="font-bold text-danger"
                    >
                      {REASON_LABELS[r.reason]}
                    </label>
                    <span className="ml-[0.9333rem] text-[0.8rem] text-ink-muted">
                      {when} · 회원 {r.reporterId}
                      {!editable &&
                        ` · ${STATUS_LABELS[r.status]}${r.handledAt ? ` ${formatReportedAt(r.handledAt)}` : ''}`}
                    </span>
                  </p>
                  {editable && (
                    <button
                      type="button"
                      aria-label={`이 건만 반려, ${REASON_LABELS[r.reason]} · ${when}`}
                      aria-disabled={busy || undefined}
                      onClick={() => !busy && onRejectOne(r)}
                      className="min-h-0 shrink-0 text-[0.8rem] font-bold text-danger aria-disabled:opacity-60"
                    >
                      이 건만 반려
                    </button>
                  )}
                </div>
                {r.reasonDetail && <p className="mt-1.5 text-[0.9333rem]">“{r.reasonDetail}”</p>}
                <p className="mt-1 text-[0.8rem] text-ink-muted">
                  {formatClock(r.reportedAtMs)} 재생 중 · 상세도 {r.detailLevel}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
