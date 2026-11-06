import { useRef, type RefObject } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'

export interface SummaryDialogProps {
  open: boolean
  summaryText: string | null
  /** Enter(처음 포커스 버튼) — 요약을 듣고 재생 */
  onListen: () => void
  /** Esc 또는 '건너뛰기'. 듣는 중이면 요약을 멈추고 창을 닫는다 (재생은 하지 않는다) */
  onSkip: () => void
  /** 창이 닫히는 즉시 포커스를 줄 곳 (재생 버튼) */
  focusAfterCloseRef: RefObject<HTMLElement | null>
}

/**
 * 영상을 열면 먼저 묻는 '30초 요약을 먼저 들을까요?' (NAV-06, 원칙 1장: 자동 재생 없음).
 * 답이 없다고 저절로 넘어가지 않는다.
 */
export function SummaryDialog({
  open,
  summaryText,
  onListen,
  onSkip,
  focusAfterCloseRef,
}: SummaryDialogProps) {
  const listenRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onClose={onSkip}
      // 요약을 듣는 중·다 들은 뒤에도 제목·버튼은 그대로 둔다 (화면이 바뀌면 낭독기가 다시 읽어 요약과 겹친다)
      title="30초 요약을 먼저 들을까요?"
      // 요약 듣기 권장(recommendSummary)은 기획에서 뺐다 (2026-11-05). 모든 영상에 같은 안내
      description="요약을 들으면 무슨 내용인지 미리 알 수 있어요."
      hideCloseButton
      initialFocusRef={listenRef}
      // 닫는 즉시 재생 버튼으로 옮긴다. 창이 원래 자리(본문·로고)로 먼저 돌려보내면 낭독기가 화면 전체를 다시 읽는다
      restoreFocus={false}
      focusAfterCloseRef={focusAfterCloseRef}
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
        <Button
          variant="secondary"
          size="xl"
          onClick={onSkip}
          aria-keyshortcuts="Escape"
        >
          건너뛰기
        </Button>
        <span aria-hidden="true" className="text-ink-muted">
          Esc
        </span>
      </div>
    </Dialog>
  )
}
