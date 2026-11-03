import { useId, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { reportsApi } from '@/api/reports'
import { ApiError, toUserMessage } from '@/api/errors'
import type { NarrationLine, ReportReason } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { Dialog } from '@/components/ui/Dialog'
import { useAnnouncer } from '@/features/announcer/context'
import { formatClock, formatPositionSpoken } from '@/utils/time'

const REASONS: { value: ReportReason; label: string; hint?: string }[] = [
  { value: 'WRONG', label: '틀린 내용', hint: '화면과 다르게 설명했어요' },
  { value: 'MISSING', label: '중요한 내용 빠짐', hint: '꼭 알아야 할 것을 말하지 않았어요' },
  { value: 'OVERLAP', label: '대사와 겹침', hint: '사람 말소리와 동시에 나와요' },
  { value: 'OTHER', label: '기타 (직접 입력)' },
]

export interface ReportDialogProps {
  open: boolean
  /** 신고 키를 누른 시점에 읽고 있던 문장 */
  line: NarrationLine | null
  /** 신고 키를 누른 순간의 영상 시각 */
  reportedAtMs: number
  onClose: () => void
}

/** '이 문장 신고' 창 (RPT-01). 사유 하나를 고르고 보낸다. 같은 문장은 한 번만 */
export function ReportDialog({ open, line, reportedAtMs, onClose }: ReportDialogProps) {
  const { announce } = useAnnouncer()
  const groupId = useId()
  const detailId = useId()
  const [reason, setReason] = useState<ReportReason>('WRONG')
  const [detail, setDetail] = useState('')
  const [detailError, setDetailError] = useState(false)
  const firstRadioRef = useRef<HTMLInputElement>(null)
  const detailRef = useRef<HTMLTextAreaElement>(null)

  // 닫을 때 처음 상태로 되돌려 다음에 열면 깨끗하게 시작한다
  const close = () => {
    setReason('WRONG')
    setDetail('')
    setDetailError(false)
    onClose()
  }

  const send = useMutation({
    mutationFn: () =>
      reportsApi.create(line!.lineId, {
        reportedAtMs,
        reason,
        reasonDetail: reason === 'OTHER' ? detail.trim() : undefined,
      }),
    onSuccess: () => {
      announce('신고했어요. 검토한 뒤 고칠게요.')
      close()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REPORT_001') {
        announce('이미 신고한 문장이에요.', { politeness: 'assertive' })
        close()
        return
      }
      announce(`신고를 보내지 못했어요. ${toUserMessage(e)}`, { politeness: 'assertive' })
    },
  })

  const submit = () => {
    if (!line) return
    if (reason === 'OTHER' && !detail.trim()) {
      setDetailError(true)
      detailRef.current?.focus()
      announce('기타를 골랐으면 무엇이 문제인지 적어 주세요.', { politeness: 'assertive' })
      return
    }
    send.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="이 문장 신고"
      initialFocusRef={firstRadioRef}
      className="overflow-y-auto p-10"
    >
      {line ? (
        <>
          <section
            aria-label={`신고할 문장, ${formatPositionSpoken(line.startMs)}`}
            className="overflow-hidden rounded-md border-2 border-navy"
          >
            <p className="bg-navy px-5 py-3 text-lg font-bold text-cream">
              신고할 문장 · <span aria-hidden="true">{formatClock(line.startMs)}</span>
            </p>
            <p className="px-5 py-4 text-xl font-bold">{line.text}</p>
          </section>

          <fieldset className="mt-6 overflow-hidden rounded-md border-2 border-navy">
            <legend className="sr-only">무엇이 문제인가요? 하나 고르기</legend>
            <p aria-hidden="true" className="bg-navy px-5 py-3 text-lg font-bold text-cream">
              무엇이 문제인가요? (하나 고르기)
            </p>
            {REASONS.map((r, i) => (
              <div
                key={r.value}
                className="border-t border-line px-5 py-4 first-of-type:border-t-0 has-[:focus-visible]:bg-yellow-soft"
              >
                <label className="flex cursor-pointer items-center gap-3 text-lg font-bold">
                  <input
                    ref={i === 0 ? firstRadioRef : undefined}
                    type="radio"
                    name={groupId}
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    aria-describedby={r.hint ? `${groupId}-${r.value}` : undefined}
                    className="size-5 accent-navy"
                  />
                  {r.label}
                </label>
                {r.hint && (
                  <p id={`${groupId}-${r.value}`} className="pl-8 text-ink-muted">
                    {r.hint}
                  </p>
                )}
              </div>
            ))}
            <div className="border-t border-line px-5 py-4">
              <label htmlFor={detailId} className="sr-only">
                기타 내용 (기타를 고르면 필수)
              </label>
              <textarea
                ref={detailRef}
                id={detailId}
                rows={2}
                maxLength={500}
                value={detail}
                onChange={(e) => {
                  setDetail(e.target.value)
                  if (e.target.value.trim()) setDetailError(false)
                }}
                onFocus={() => setReason('OTHER')}
                placeholder="기타를 고르면 여기에 적어요 (선택)"
                aria-invalid={detailError || undefined}
                className={cn(
                  'w-full rounded-md border-2 bg-paper px-4 py-3 text-lg',
                  detailError ? 'border-danger' : 'border-line',
                )}
              />
            </div>
          </fieldset>

          <div className="mt-6 flex gap-3">
            <Button variant="accent" size="xl" onClick={submit} disabled={send.isPending}>
              {send.isPending ? '보내는 중' : '신고 보내기'}
            </Button>
            <Button variant="secondary" size="xl" onClick={close}>
              취소
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xl">아직 읽은 해설 문장이 없어요. 재생한 뒤에 신고해 주세요.</p>
          <div className="mt-6">
            <Button variant="secondary" size="xl" onClick={close}>
              닫기
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
