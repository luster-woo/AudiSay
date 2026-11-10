import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/api/queryKeys'
import type { ReportStatus } from '@/api/types'
import { cn } from '@/components/ui/cn'
import { AdminPagination } from '@/features/admin/AdminPagination'
import { ReportDetail } from '@/features/admin/ReportDetail'
import { ReportList } from '@/features/admin/ReportList'
import {
  fetchAllReports,
  groupReports,
  STATUS_LABELS,
  type ReportSort,
} from '@/features/admin/reports'
import { StatusSwitch } from '@/features/admin/StatusSwitch'
import { usePendingReportCount } from '@/features/admin/usePendingReportCount'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'

/** 게시판 한 쪽에 보일 문장(묶음) 수 */
const PAGE_SIZE = 20
const STATUSES: ReportStatus[] = ['PENDING', 'RESOLVED', 'REJECTED']

/** 주소의 ?status= (없으면 처리 전) */
function useStatus(): ReportStatus {
  const [params] = useSearchParams()
  const raw = params.get('status') as ReportStatus | null
  return raw && STATUSES.includes(raw) ? raw : 'PENDING'
}

/** 한 상태의 신고를 모두 받아 문장 단위로 묶는다 (목록·상세가 같은 캐시를 쓴다) */
function useReportGroups(status: ReportStatus, sort: ReportSort) {
  const query = useQuery({
    queryKey: queryKeys.admin.reports({ status, all: true }),
    queryFn: () => fetchAllReports(status),
  })
  const groups = useMemo(
    () => (query.data ? groupReports(query.data, sort) : []),
    [query.data, sort],
  )
  return { ...query, groups }
}

/**
 * 신고 처리 (ADM-01). 게시판처럼 나눴다:
 * - /admin/reports: 신고 목록 (같은 문장 신고는 한 줄)
 * - /admin/reports/:reportId: 그 문장의 상세만 (장면 확인·문장 고치기·처리)
 * 처리 상태는 주소 ?status= 에 둬서 목록과 상세가 같은 상태를 본다.
 */
export default function ReportsPage() {
  const { reportId } = useParams()
  return reportId ? <ReportDetailView reportId={reportId} /> : <ReportListView />
}

function ReportListView() {
  const navigate = useNavigate()
  const { announce } = useAnnouncer()
  const status = useStatus()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const pendingCount = usePendingReportCount()
  const [sort, setSort] = useState<ReportSort>('oldest')
  const [page, setPage] = useState(0)
  const { groups, isError, isFetched, data } = useReportGroups(status, sort)

  // 화면 진입(제목 포커스·안내)은 처음 한 번만, 그때의 문구로 고정한다. 처리 상태를 바꿔 다시 받거나 처리 전 건수가
  // 늦게 와도 제목으로 포커스가 튀거나 진입 안내를 다시 읽지 않게 한다 (상태 라디오를 ← → 로 옮기던 포커스를 지킨다)
  const [entryText, setEntryText] = useState<string | null>(null)
  if (entryText === null && isFetched)
    setEntryText(
      pendingCount === undefined
        ? '신고 처리 화면이에요.'
        : `신고 처리 화면이에요. 처리 전 ${pendingCount}건.`,
    )
  usePageEntry({
    title: '신고 처리',
    announce: entryText ?? '',
    focusRef: headingRef,
    ready: entryText !== null,
  })

  // 상태를 바꾼 뒤에는 포커스를 그대로 두고 결과만 알린다 ('처리 완료 12건')
  const announcedStatus = useRef(status)
  useEffect(() => {
    if (!isFetched || announcedStatus.current === status) return
    announcedStatus.current = status
    announce(`${STATUS_LABELS[status]} ${groups.length}건.`)
  }, [status, isFetched, groups.length, announce])

  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE))
  const current = Math.min(page, totalPages - 1)
  const shown = groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  const changeStatus = (next: ReportStatus) => {
    setPage(0)
    navigate(next === 'PENDING' ? '/admin/reports' : `/admin/reports?status=${next}`)
  }
  const changePage = (next: number) => {
    setPage(next)
    headingRef.current?.focus()
  }

  const sortButton = (value: ReportSort, label: string) => (
    <button
      type="button"
      aria-pressed={sort === value}
      onClick={() => {
        setSort(value)
        setPage(0)
      }}
      className={cn(
        'min-h-0 border-b-2 py-0.5 text-[0.8667rem]',
        sort === value ? 'border-navy font-bold text-ink' : 'border-transparent text-ink-muted',
      )}
    >
      {label}
    </button>
  )

  return (
    <div>
      {/* 다른 관리자 화면(통계·회원)과 같은 위쪽 양식: 화면 제목 → 그 아래 조작 줄 */}
      <h1 className="text-[1.4667rem] leading-snug font-bold">신고 처리</h1>
      <section aria-labelledby="report-list-title" className="mt-[1.2rem] rounded-md bg-paper">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <h2
              id="report-list-title"
              ref={headingRef}
              tabIndex={-1}
              className="text-[1.0667rem] font-bold outline-none"
            >
              {STATUS_LABELS[status]} {data ? `${groups.length}건` : ''}
            </h2>
            <StatusSwitch value={status} onChange={changeStatus} pendingCount={pendingCount} />
          </div>
          <div role="group" aria-label="정렬" className="flex items-center gap-2">
            {sortButton('oldest', '오래된 순')}
            <span aria-hidden="true" className="text-[0.8rem] text-line">
              |
            </span>
            {sortButton('most', '신고 많은 순')}
          </div>
        </div>
        {isError && <p className="px-4 py-6">신고 목록을 불러오지 못했어요.</p>}
        {data && groups.length === 0 && (
          <p className="px-4 py-6">{STATUS_LABELS[status]} 신고가 없어요.</p>
        )}
        {shown.length > 0 && <ReportList groups={shown} status={status} />}
        {totalPages > 1 && (
          <AdminPagination
            page={current}
            totalPages={totalPages}
            onChange={changePage}
            className="py-4"
          />
        )}
      </section>
    </div>
  )
}

function ReportDetailView({ reportId }: { reportId: string }) {
  const navigate = useNavigate()
  const status = useStatus()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { groups, isFetched, isError } = useReportGroups(status, 'oldest')
  const listUrl = status === 'PENDING' ? '/admin/reports' : `/admin/reports?status=${status}`
  const query = status === 'PENDING' ? '' : `?status=${status}`

  const group = groups.find((g) => g.reports.some((r) => String(r.reportId) === reportId))
  const otherLines = group
    ? groups.filter((g) => g.first.videoId === group.first.videoId && g.lineId !== group.lineId)
    : []

  usePageEntry({
    title: '신고 상세',
    announce: group
      ? `신고 상세예요. ${group.first.videoTitle}, 신고 ${group.count}건.`
      : '신고 상세예요.',
    focusRef: headingRef,
    ready: isFetched,
  })

  const back = (
    <Link
      to={listUrl}
      className="inline-flex min-h-[2.8rem] items-center gap-1.5 rounded-sm text-[1.2rem] font-bold text-navy"
    >
      <span aria-hidden="true">←</span> {STATUS_LABELS[status]} 신고 목록
    </Link>
  )

  if (!group) {
    return (
      <>
        <h1 className="sr-only">신고 처리</h1>
        {back}
        <h2 ref={headingRef} tabIndex={-1} className="mt-4 text-[1.2rem] font-bold outline-none">
          {isError
            ? '신고를 불러오지 못했어요'
            : isFetched
              ? '이 신고를 찾지 못했어요'
              : '신고를 불러오는 중이에요'}
        </h2>
        {isFetched && !isError && (
          <p className="mt-2">이미 처리됐거나 다른 처리 상태에 있을 수 있어요.</p>
        )}
      </>
    )
  }

  return (
    <>
      <h1 className="sr-only">신고 처리</h1>
      {/* 바탕은 다른 관리자 화면과 같은 크림색. 바깥 여백 없이 화면을 채운다. 위는 목록으로 돌아가기, 아래는 상세 (버튼 줄은 맨 아래 고정) */}
      <div className="-m-8 flex h-svh flex-col overflow-hidden">
        <div className="shrink-0 px-[2.1333rem] pt-3">{back}</div>
        <div className="min-h-0 flex-1">
          <ReportDetail
            key={`${status}-${group.lineId}`}
            group={group}
            otherLines={otherLines}
            editable={status === 'PENDING'}
            headingRef={headingRef}
            onHandled={(remaining) =>
              navigate(remaining[0] ? `/admin/reports/${remaining[0].reportId}${query}` : listUrl, {
                replace: true,
              })
            }
          />
        </div>
      </div>
    </>
  )
}
