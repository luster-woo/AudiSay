import { useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { Dialog } from '@/components/ui/Dialog'

export interface StatusDialogProps {
  open: boolean
  /** 머리말 ('업로드 불가', '확인', '업로드 멈춤') */
  kicker: string
  tone: 'danger' | 'info' | 'success'
  title: string
  children?: ReactNode
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel: string
  onSecondary: () => void
  /** Esc 를 눌렀을 때. 기본은 아래쪽 버튼과 같다. 되돌릴 수 없는 버튼이면 따로 정한다 */
  onEscape?: () => void
}

/**
 * 업로드 화면의 알림창 (Figma: 머리말 + 큰 제목 + 설명 + 버튼 두 개를 위아래로).
 * 처음 포커스는 위쪽 노란 버튼 — 되돌릴 수 없는 동작(멈추기·취소)은 아래쪽에 둔다.
 */
export function StatusDialog({
  open,
  kicker,
  tone,
  title,
  children,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onEscape = onSecondary,
}: StatusDialogProps) {
  const primaryRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onClose={onEscape}
      title={title}
      alert={tone === 'danger'}
      hideCloseButton
      initialFocusRef={primaryRef}
      titleClassName="text-[2.25rem] leading-snug"
      kicker={
        <p
          className={cn(
            'flex items-center gap-2 text-2xl font-bold',
            tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-navy',
          )}
        >
          <span aria-hidden="true">●</span>
          {kicker}
        </p>
      }
      className="p-12"
    >
      {children && <div className="space-y-6 text-2xl">{children}</div>}
      <div className="mt-10 flex flex-col gap-5">
        <Button ref={primaryRef} variant="accent" size="2xl" onClick={onPrimary}>
          {primaryLabel}
        </Button>
        <Button variant="secondary" size="2xl" onClick={onSecondary}>
          {secondaryLabel}
        </Button>
      </div>
    </Dialog>
  )
}
