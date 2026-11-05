import { useContext, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { LiveHostContext } from '@/features/announcer/context'
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
  /**
   * 닫힌 뒤 열기 전 자리로 포커스를 돌려보낼지 (기본 true).
   * 닫을 때 부모가 직접 다른 곳으로 포커스를 옮기면 false — 두 번 옮겨져 낭독기가 두 곳을 읽는다
   */
  restoreFocus?: boolean
  /** 열릴 때 제목(h2)에 포커스. 긴 글 창처럼 처음부터 읽어 내려가야 할 때 */
  focusTitle?: boolean
  /** 긴 글 창: 창 전체가 스크롤되고(안쪽 스크롤 상자 없음) 제목 줄과 버튼 줄은 위·아래에 붙어 있다 */
  longForm?: boolean
  hideCloseButton?: boolean
  /** 제목 위 작은 머리말 ('● 업로드 불가'). 제목과 함께 창 이름으로 읽히지 않게 따로 둔다 */
  kicker?: ReactNode
  /** 제목 크기를 바꿀 때 (기본 text-2xl) */
  titleClassName?: string
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
  restoreFocus = true,
  focusTitle = false,
  longForm = false,
  hideCloseButton = false,
  kicker,
  titleClassName,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descId = useId()
  const registerLiveHost = useContext(LiveHostContext)
  const unregisterRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      returnFocusRef.current = restoreFocus ? (document.activeElement as HTMLElement | null) : null
      el.showModal()
      // 창 바깥은 inert 가 되므로 안내 영역(aria-live)을 이 창 안으로 옮긴다
      unregisterRef.current = registerLiveHost(el)
      if (focusTitle) titleRef.current?.focus()
      else initialFocusRef?.current?.focus()
    } else if (!open && el.open) {
      el.close()
      unregisterRef.current?.()
      unregisterRef.current = null
    }
  }, [open, initialFocusRef, focusTitle, restoreFocus, registerLiveHost])

  // 창이 열린 채로 화면을 떠나면(라우트 이동) 안내 영역 자리를 돌려놓는다
  useEffect(
    () => () => {
      unregisterRef.current?.()
      unregisterRef.current = null
    },
    [],
  )

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
        'm-auto max-h-[90svh] w-[min(48rem,calc(100%-2rem))] rounded-lg bg-paper text-ink',
        'backdrop:bg-ink/60 hc:backdrop:bg-black/80',
        // 고대비: 검정 창이 검정 배경에 묻히지 않게 흰 테두리
        'hc:border-2 hc:border-ink',
        longForm ? 'overflow-y-auto p-0' : 'p-8',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-start justify-between gap-6',
          longForm && 'sticky top-0 z-10 border-b-2 border-line bg-paper px-8 pt-6 pb-5',
        )}
      >
        <div>
          {kicker && <div className="mb-3">{kicker}</div>}
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={focusTitle ? -1 : undefined}
            className={cn('text-2xl font-bold outline-none', titleClassName)}
          >
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
      {children && <div className={longForm ? 'px-8 py-6' : 'mt-6'}>{children}</div>}
      {footer && (
        <div
          className={cn(
            'flex flex-wrap justify-end gap-3',
            longForm ? 'sticky bottom-0 border-t-2 border-line bg-paper px-8 py-5' : 'mt-8',
          )}
        >
          {footer}
        </div>
      )}
    </dialog>
  )
}
