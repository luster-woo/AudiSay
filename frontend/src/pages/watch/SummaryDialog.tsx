import { useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'

export interface SummaryDialogProps {
  open: boolean
  summaryText: string | null
  /** Enter(처음 포커스 버튼) — 요약을 듣고 재생 */
  onListen: () => void
  /** Esc 또는 '바로 재생' */
  onSkip: () => void
}

/**
 * 영상을 열면 먼저 묻는 '30초 요약을 먼저 들을까요?' (NAV-06, 원칙 1장: 자동 재생 없음).
 * 답이 없다고 저절로 넘어가지 않는다.
 */
export function SummaryDialog({ open, summaryText, onListen, onSkip }: SummaryDialogProps) {
  const listenRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onClose={onSkip}
      title="30초 요약을 먼저 들을까요?"
      // 요약 듣기 권장(recommendSummary)은 기획에서 뺐다 (2026-11-05). 모든 영상에 같은 안내
      description="요약을 들으면 무슨 내용인지 미리 알 수 있어요."
      hideCloseButton
      initialFocusRef={listenRef}
      className="p-10"
    >
      {summaryText && (
        <p className="rounded-md bg-cream px-5 py-4 text-lg leading-relaxed text-ink">
          {summaryText}
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-4">
        <Button
          ref={listenRef}
          variant="accent"
          size="xl"
          onClick={onListen}
          aria-keyshortcuts="Enter"
        >
          요약 듣고 시작
        </Button>
        <span aria-hidden="true" className="mr-3 text-ink-muted">
          Enter
        </span>
        <Button variant="secondary" size="xl" onClick={onSkip} aria-keyshortcuts="Escape">
          바로 재생
        </Button>
        <span aria-hidden="true" className="text-ink-muted">
          Esc
        </span>
      </div>
    </Dialog>
  )
}
