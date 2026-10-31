import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { cn } from './cn'

export interface DialogProps {
  open: boolean
  /** Esc·닫기 버튼으로 닫으려 할 때. 실제로 닫는 건 부모가 open 을 false 로 바꿔서 한다 */
  onClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  alert?: boolean
  /** 열릴 때 포커스를 줄 요소. 없으면 브라우저 기본(첫 번째 포커스 가능한 요소) */
  initialFocusRef?: RefObject<HTMLElement | null>
  hideCloseButton?: boolean
  className?: string
}

/**
 * 네이티브 <dialog> + showModal().
 * 브라우저가 해 주는 것: 바깥 내용 비활성화(inert), Tab 이 창 안에서만 돎, Esc 감지.
 * 우리가 하는 것: open 상태 동기화, 처음 포커스, 닫힌 뒤 원래 버튼으로 포커스 복귀.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  alert = false,
  initialFocusRef,
  hideCloseButton = false,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null
      el.showModal()
      initialFocusRef?.current?.focus()
    } else if (!open && el.open) {
      el.close()
    }
  }, [open, initialFocusRef])

  // 닫히면 열기 전에 포커스가 있던 곳(보통 이 창을 연 버튼)으로 돌려보낸다
  useEffect(() => {
    if (!open && returnFocusRef.current) {
      returnFocusRef.current.focus()
      returnFocusRef.current = null
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      role={alert ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={cn(
        'm-auto max-h-[90svh] w-[min(48rem,calc(100%-2rem))] rounded-lg bg-paper p-8 text-ink',
        'backdrop:bg-ink/60',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 id={titleId} className="text-2xl font-bold">
            {title}
          </h2>
          {description && (
            <div id={descId} className="mt-2 text-ink-muted">
              {description}
            </div>
          )}
        </div>
        {!hideCloseButton && (
          <button
            type="button"
            onClick={onClose}
            className="min-h-touch shrink-0 rounded-md border-2 border-navy px-4 font-bold text-navy"
          >
            닫기
          </button>
        )}
      </div>
      {children && <div className="mt-6">{children}</div>}
      {footer && <div className="mt-8 flex flex-wrap justify-end gap-3">{footer}</div>}
    </dialog>
  )
}