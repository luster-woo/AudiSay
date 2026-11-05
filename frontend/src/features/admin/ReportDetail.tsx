import { useState, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { toUserMessage } from '@/api/errors'
import { queryKeys } from '@/api/queryKeys'
import type { AdminReport, ReportStatus } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { Tabs } from '@/components/ui/Tabs'
import { useAnnouncer } from '@/features/announcer/context'
import { RegenerateButton } from './RegenerateButton'
import { ReportTab } from './ReportTab'
import type { ReportGroup } from './reports'
import { SceneTab } from './SceneTab'

type DetailTab = 'scene' | 'reports'
type Handled = Exclude<ReportStatus, 'PENDING'>

export interface ReportDetailProps {
  group: ReportGroup
  /** 같은 영상에서 신고가 들어온 다른 문장들 */
  otherLines: ReportGroup[]
  /** 처리 전 목록이면 true. 처리된 신고는 다시 처리할 수 없다 (409 REPORT_003) */
  editable: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
  /** 처리 후 남은 신고가 있으면 그 신고로, 없으면 목록 처음으로 */
  onHandled: (remaining: AdminReport[]) => void
}

/**
 * 신고 처리 오른쪽: 장면 탭에서 문장을 고치고, 신고 탭에서 신고를 고른 뒤 아래 버튼으로 처리한다.
 * 문장이 바뀌면 부모가 key 로 새로 만들어 고치던 내용·선택이 섞이지 않게 한다.
 */
export function ReportDetail({
  group,
  otherLines,
  editable,
  headingRef,
  onHandled,
}: ReportDetailProps) {
  const first = group.first
  const { announce } = useAnnouncer()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<DetailTab>('scene')
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(group.reports.map((r) => r.reportId)),
  )
  // null 이면 아직 손대지 않은 것 → 서버 값을 그대로 보여 준다
  const [draft, setDraft] = useState<string | null>(null)
  const [importance, setImportance] = useState<1 | 2 | 3 | null>(null)

  const review = useQuery({
    queryKey: queryKeys.admin.review(first.videoId, first.descriptionId),
    queryFn: () =>
      adminApi.reviewDescription(first.videoId, { descriptionId: first.descriptionId }),
  })
  const line = review.data?.lines.find((l) => l.lineId === first.lineId)
  const text = draft ?? line?.text ?? first.currentText
  const level = importance ?? line?.importance ?? 2
  const dirty = !!line && (text.trim() !== line.text || level !== line.importance)

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })
  const fail = (err: unknown) => announce(toUserMessage(err), { politeness: 'assertive' })

  const saveLine = useMutation({
    mutationFn: () =>
      adminApi.updateLine(first.lineId, {
        text: text.trim(),
        importance: line && level !== line.importance ? level : undefined,
      }),
    onSuccess: () => {
      setDraft(null)
      setImportance(null)
      announce('해설 문장을 저장했어요. 음성을 다시 만드는 중이에요.')
      void refresh()
    },
    onError: fail,
  })

  const remakeAudio = useMutation({
    mutationFn: () => adminApi.regenerateLineAudio(first.lineId),
    onSuccess: () => {
      announce('음성을 다시 만드는 중이에요. 잠시 뒤 다시 들어 보세요.')
      void refresh()
    },
    onError: fail,
  })

  const handle = useMutation({
    mutationFn: async ({ status, ids }: { status: Handled; ids: number[] }) => {
      // 전부 고르면 한 번에 처리한다 (이 페이지에 안 보이는 같은 문장 신고까지)
      if (ids.length === group.reports.length) {
        const res = await adminApi.handleReport(ids[0], status, true)
        return res.updatedReportIds.length
      }
      for (const id of ids) await adminApi.handleReport(id, status)
      return ids.length
    },
    onSuccess: (count, { status, ids }) => {
      announce(`신고 ${count}건을 ${status === 'RESOLVED' ? '처리 완료' : '반려'}했어요.`)
      void refresh()
      onHandled(group.reports.filter((r) => !ids.includes(r.reportId)))
    },
    onError: (err) => {
      fail(err)
      void refresh()
    },
  })

  const selected = group.reports.filter((r) => selectedIds.has(r.reportId)).map((r) => r.reportId)
  const save = () => {
    if (!text.trim()) {
      announce('해설 문장을 1자 이상 써 주세요.', { politeness: 'assertive' })
      setTab('scene')
      return
    }
    saveLine.mutate()
  }

  const scenePanel = review.isError ? (
    <p>해설을 불러오지 못했어요.</p>
  ) : !review.data ? (
    <p>해설을 불러오는 중이에요.</p>
  ) : !line ? (
    <p>이 문장을 해설에서 찾지 못했어요. 해설이 다시 만들어졌을 수 있어요.</p>
  ) : (
    <SceneTab
      review={review.data}
      line={line}
      draft={text}
      onDraftChange={setDraft}
      importance={level}
      onImportanceChange={setImportance}
    />
  )

  return (
    // 위는 스크롤, 아래 버튼 줄은 화면 맨 아래에 고정 (Figma)
    <section aria-labelledby="report-detail-title" className="flex h-full min-w-0 flex-col">
      {/* relative: 안쪽 sr-only(절대 위치) 요소가 스크롤 상자 밖 기준으로 잡혀 페이지 전체를 늘리지 않게 */}
      <div className="relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] px-[2.1333rem] pt-[1.4rem] pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="report-detail-title"
              ref={headingRef}
              tabIndex={-1}
              className="text-[1.4667rem] leading-snug font-bold outline-none"
            >
              {first.videoTitle}
            </h2>
          </div>
          {/* 장면 탭에서만 쓴다. 신고 탭에서는 자리만 남겨 제목 줄 높이가 바뀌지 않게 */}
          <div className={cn(tab !== 'scene' && 'invisible')}>
            <RegenerateButton videoId={first.videoId} videoTitle={first.videoTitle} />
          </div>
        </div>

        <Tabs
          label="신고 내용"
          value={tab}
          onChange={setTab}
          size="sm"
          className="mt-[0.9rem]"
          items={[
            { value: 'scene', label: '장면', panel: scenePanel },
            {
              value: 'reports',
              label: `신고 ${group.count}`,
              panel: (
                <ReportTab
                  group={group}
                  otherLines={otherLines}
                  editable={editable}
                  selectedIds={selectedIds}
                  onSelectedChange={setSelectedIds}
                />
              ),
            },
          ]}
        />
      </div>

      <div className="mx-[2.1333rem] flex h-[5.3333rem] shrink-0 items-center justify-between gap-3 border-t border-line">
        {/* 문장 저장·음성만 다시는 장면 탭에서 고치는 문장 것이라 그 탭에서만 보인다 (자리는 남겨 오른쪽 버튼이 움직이지 않게) */}
        <div className={cn('flex gap-[0.6rem]', tab !== 'scene' && 'invisible')}>
          <Button
            variant="secondary"
            size="md"
            disabled={!dirty}
            loading={saveLine.isPending}
            onClick={save}
          >
            문장 저장
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={!line}
            loading={remakeAudio.isPending}
            onClick={() => remakeAudio.mutate()}
          >
            음성만 다시
          </Button>
        </div>
        {editable && (
          <div className="flex items-center gap-3">
            <Button
              variant="danger"
              size="md"
              className="min-w-[9rem]"
              disabled={selected.length === 0 || handle.isPending}
              onClick={() => handle.mutate({ status: 'REJECTED', ids: selected })}
            >
              {selected.length}건 반려
            </Button>
            <Button
              variant="accent"
              size="md"
              className="min-w-[11rem] border-yellow"
              disabled={selected.length === 0}
              loading={handle.isPending}
              onClick={() => handle.mutate({ status: 'RESOLVED', ids: selected })}
            >
              {selected.length}건 처리 완료
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
