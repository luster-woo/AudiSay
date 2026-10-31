import { useRef, type ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: ReactNode
  children?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** 되돌릴 수 없는 일이면 확인 버튼을 빨갛게 */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * "정말 할까요?" 확인창 (예: 해설 전부 다시 만들기).
 * 실수로 Enter 를 눌러도 위험한 일이 일어나지 않게 처음 포커스는 '취소'에 둔다.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = '취소',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      alert
      hideCloseButton
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="accent" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}