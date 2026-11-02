import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { queryKeys } from '@/api/queryKeys'
import type { ReportStatus } from '@/api/types'
import { cn } from '@/components/ui/cn'
import { Pagination } from '@/components/ui/Pagination'
import { ReportDetail } from '@/features/admin/ReportDetail'
import { ReportList } from '@/features/admin/ReportList'
import { groupReports, STATUS_LABELS, type ReportSort } from '@/features/admin/reports'
import { StatusSwitch } from '@/features/admin/StatusSwitch'
import { usePendingReportCount } from '@/features/admin/usePendingReportCount'
import { usePageEntry } from '@/features/page/usePageEntry'
import { useAdminTopbar } from '@/layouts/parts/adminTopbar'

/** 서버 최대 50. 같은 문장 신고를 한 줄로 묶으려면 한 번에 많이 받는 게 낫다 */
const PAGE_SIZE = 50

/** 신고 처리 (ADM-01): 왼쪽 신고 목록 + 오른쪽 장면·신고 확인 */
export default function ReportsPage() {
  const { reportId } = useParams()
  const navigate = useNavigate()
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const detailHeadingRef = useRef<HTMLHeadingElement>(null)
  const topbar = useAdminTopbar()
  const [status, setStatus] = useState<ReportStatus>('PENDING')
  const [sort, setSort] = useState<ReportSort>('oldest')
  const [page, setPage] = useState(0)
  const pendingCount = usePendingReportCount()

  const params = { status, page, size: PAGE_SIZE }
  const { data, isError, isFetched } = useQuery({
    queryKey: queryKeys.admin.reports(params),
    queryFn: () => adminApi.reports(params),
    placeholderData: keepPreviousData,
  })

  usePageEntry({
    title: '신고 처리',
    announce:
      pendingCount === undefined
        ? '신고 처리 화면이에요.'
        : `신고 처리 화면이에요. 처리 전 ${pendingCount}건.`,
    focusRef: listHeadingRef,
    ready: isFetched,
  })

  const groups = useMemo(() => (data ? groupReports(data.content, sort) : []), [data, sort])
  const selected =
    groups.find((g) => g.reports.some((r) => String(r.reportId) === reportId)) ?? groups[0]
  const otherLines = selected
    ? groups.filter(
        (g) => g.first.videoId === selected.first.videoId && g.lineId !== selected.lineId,
      )
    : []

  // 목록에서 문장을 고르면 오른쪽 제목으로 포커스를 옮긴다 (처음 들어올 때는 목록 제목에 둔다)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (reportId) detailHeadingRef.current?.focus()
  }, [reportId])

  const changeStatus = (next: ReportStatus) => {
    setStatus(next)
    setPage(0)
    navigate('/admin/reports')
  }

  const sortButton = (value: ReportSort, label: string) => (
    <button
      type="button"
      aria-pressed={sort === value}
      onClick={() => setSort(value)}
      className={cn(
        'min-h-0 border-b-2 py-0.5 text-[0.8rem]',
        sort === value ? 'border-navy font-bold text-ink' : 'border-transparent text-ink-muted',
      )}
    >
      {label}
    </button>
  )

  // 바깥 여백 없이 화면을 꽉 채운다 (Figma: 목록 400px + 상세, 위쪽 줄 48px 아래 전체)
  const list = (
    <div className="-m-8 grid h-[calc(100svh-3.2rem)] grid-cols-[26.6667rem_minmax(0,1fr)]">
      <section
        aria-labelledby="report-list-title"
        className="overflow-y-auto border-r border-line bg-paper"
      >
        <div className="flex h-[3.4rem] items-center justify-between gap-2 px-[1.6rem]">
          <h2
            id="report-list-title"
            ref={listHeadingRef}
            tabIndex={-1}
            className="text-base font-bold outline-none"
          >
            {STATUS_LABELS[status]} {data ? `${data.page.totalElements}건` : ''}
          </h2>
          <div role="group" aria-label="정렬" className="flex items-center gap-2">
            {sortButton('oldest', '오래된 순')}
            <span aria-hidden="true" className="text-[0.8rem] text-line">
              |
            </span>
            {sortButton('most', '신고 많은 순')}
          </div>
        </div>
        {isError && <p className="px-[1.6rem] py-6">신고 목록을 불러오지 못했어요.</p>}
        {data && groups.length === 0 && (
          <p className="px-[1.6rem] py-6">{STATUS_LABELS[status]} 신고가 없어요.</p>
        )}
        <ReportList groups={groups} selectedLineId={selected?.lineId ?? null} />
        {data && data.page.totalPages > 1 && (
          <Pagination page={data.page} onChange={setPage} unit="건" className="px-4 py-3" />
        )}
      </section>

      {selected && (
        <ReportDetail
          key={`${status}-${selected.lineId}`}
          group={selected}
          otherLines={otherLines}
          editable={status === 'PENDING'}
          headingRef={detailHeadingRef}
          onHandled={(remaining) =>
            navigate(remaining[0] ? `/admin/reports/${remaining[0].reportId}` : '/admin/reports', {
              replace: true,
            })
          }
        />
      )}
    </div>
  )

  return (
    <>
      {/* 화면 제목은 위쪽 브레드크럼이 보여 주므로 h1 은 낭독기용으로만 둔다 (와이어프레임) */}
      <h1 className="sr-only">신고 처리</h1>
      {topbar &&
        createPortal(
          <StatusSwitch value={status} onChange={changeStatus} pendingCount={pendingCount} />,
          topbar,
        )}
      {list}
    </>
  )
}
