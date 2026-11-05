import { useEffect, useRef } from 'react'
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
}

/** 체크박스 (남색). 표 글자에 맞춰 조금 크게 */
const CHECK = 'size-5 min-h-0 shrink-0 cursor-pointer accent-navy'
const TH = 'px-4 py-3 font-bold'
const TD = 'px-4 py-3.5 align-top'

/** 신고 탭: 이 문장에 들어온 신고들을 표로 보여 준다. 고른 신고만 아래 버튼으로 처리 완료·반려한다 */
export function ReportTab({
  group,
  otherLines,
  editable,
  selectedIds,
  onSelectedChange,
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
      <p className="text-[1.0667rem] text-ink-muted">
        이 문장에 대한 신고 {group.count}건
        {otherCount > 0 && ` · 같은 영상의 다른 문장 신고 ${otherCount}건 (${otherTimes})`}
      </p>

      <div className="mt-[0.8667rem] overflow-x-auto rounded-md border border-line bg-paper">
        <table className="w-full border-collapse text-left text-[1.0667rem]">
          <caption className="sr-only">이 문장에 들어온 신고 {group.count}건</caption>
          <thead className="border-b-2 border-line text-[0.9333rem] text-ink-muted">
            <tr>
              {editable && (
                <th scope="col" className={`${TH} w-[3.5rem]`}>
                  <input
                    ref={allRef}
                    type="checkbox"
                    aria-label="전체 선택"
                    checked={allSelected}
                    onChange={(e) =>
                      onSelectedChange(
                        e.target.checked ? new Set(all.map((r) => r.reportId)) : new Set(),
                      )
                    }
                    className={CHECK}
                  />
                </th>
              )}
              {/* 사유·신고 내용은 글 길이가 달라 폭을 정해 둔다. 나머지 칸은 글자만큼 */}
              <th scope="col" className={`${TH} w-[14%] whitespace-nowrap`}>
                사유
              </th>
              {/* 신고 내용은 사유와 조금 더 띄운다 (왼쪽 여백 +50px) */}
              <th scope="col" className={`${TH} w-[32%] pl-[calc(1rem+50px)]!`}>
                신고 내용
              </th>
              <th scope="col" className={`${TH} whitespace-nowrap`}>
                신고 위치
              </th>
              <th scope="col" className={`${TH} whitespace-nowrap`}>
                신고일
              </th>
              <th scope="col" className={`${TH} whitespace-nowrap`}>
                회원 ID
              </th>
              {!editable && (
                <th scope="col" className={`${TH} whitespace-nowrap`}>
                  처리
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {all.map((r) => {
              const when = formatReportedAt(r.createdAt)
              return (
                <tr key={r.reportId} className="border-b border-line last:border-b-0">
                  {editable && (
                    <td className={TD}>
                      <input
                        type="checkbox"
                        aria-label={`${REASON_LABELS[r.reason]} · ${when} · 회원 ${r.reporterId}`}
                        checked={selectedIds.has(r.reportId)}
                        onChange={(e) => toggle(r.reportId, e.target.checked)}
                        className={`${CHECK} mt-0.5`}
                      />
                    </td>
                  )}
                  <td className={`${TD} font-bold whitespace-nowrap text-danger`}>
                    {REASON_LABELS[r.reason]}
                  </td>
                  <td className={`${TD} break-keep pl-[calc(1rem+50px)]! [overflow-wrap:anywhere]`}>
                    {r.reasonDetail ? (
                      `“${r.reasonDetail}”`
                    ) : (
                      <span className="text-ink-muted">없음</span>
                    )}
                  </td>
                  {/* 회원이 신고 버튼을 누른 영상 위치 */}
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>
                    {formatClock(r.reportedAtMs)}에 신고
                  </td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{when}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{r.reporterId}</td>
                  {!editable && (
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>
                      {STATUS_LABELS[r.status]}
                      {r.handledAt && ` ${formatReportedAt(r.handledAt)}`}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
