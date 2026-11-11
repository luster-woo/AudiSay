import { useContext, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { LiveHostContext } from '@/features/announcer/context'
import { LiveRegions } from '@/features/announcer/AnnouncerProvider'
import { cn } from './cn'

/** Tab 으로 갈 수 있는 요소 */
const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="slider"]'

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
  /**
   * 닫는 즉시(같은 순간) 포커스를 줄 곳. 브라우저가 열기 전 자리(본문 등)로 먼저 돌려보내면
   * 낭독기가 그 자리와 화면 전체를 읽기 시작하므로, 닫자마자 바로 옮겨 한 곳만 읽게 한다
   */
  focusAfterCloseRef?: RefObject<HTMLElement | null>
  /** 열릴 때 제목(h2)에 포커스. 긴 글 창처럼 처음부터 읽어 내려가야 할 때 */
  focusTitle?: boolean
  /** 긴 글 창: 창 전체가 스크롤되고(안쪽 스크롤 상자 없음) 제목 줄과 버튼 줄은 위·아래에 붙어 있다 */
  longForm?: boolean
  hideCloseButton?: boolean
  /** 제목 위 작은 머리말 ('● 업로드 불가'). 제목과 함께 창 이름으로 읽히지 않게 따로 둔다 */
  kicker?: ReactNode
  /** 제목 크기를 바꿀 때 (기본 text-2xl) */
  titleClassName?: string
  /** 닫기 버튼 글자 크기 등을 바꿀 때 */
  closeButtonClassName?: string
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
  focusAfterCloseRef,
  focusTitle = false,
  longForm = false,
  hideCloseButton = false,
  kicker,
  titleClassName,
  closeButtonClassName,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descId = useId()
  const registerLiveHost = useContext(LiveHostContext)
  const liveHostId = useId()
  const unregisterRef = useRef<(() => void) | null>(null)
  // 부모가 정한 열림 상태 (네이티브 close 이벤트에서 읽는다)
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      returnFocusRef.current = restoreFocus ? (document.activeElement as HTMLElement | null) : null
      el.showModal()
      // 창 바깥은 inert 가 되므로 안내는 이 창 안의 LiveRegions 에 쓴다 (영역을 옮기지 않는다 — context.ts 참고)
      unregisterRef.current = registerLiveHost(liveHostId)
      if (focusTitle) titleRef.current?.focus()
      else initialFocusRef?.current?.focus()
    } else if (!open && el.open) {
      el.close()
      unregisterRef.current?.()
      unregisterRef.current = null
      focusAfterCloseRef?.current?.focus({ preventScroll: true })
    }
  }, [
    open,
    initialFocusRef,
    focusTitle,
    restoreFocus,
    registerLiveHost,
    focusAfterCloseRef,
    liveHostId,
  ])

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
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- onKeyDown 은 포커스 가두기(Tab)뿐, 창 자체는 조작 요소가 아니다
    <dialog
      ref={ref}
      role={alert ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      // 브라우저가 창을 강제로 닫을 때가 있다(크롬은 사용자 동작 없이 Esc 를 두 번 누르면 cancel 을 막을 수 없게 하고 닫는다).
      // 부모 상태는 아직 열림이라, 그대로 두면 안내 영역이 닫힌 창에 남아 이후 안내가 전부 읽히지 않고
      // 닫으면 안 되는 창(업로드 끊김 등)은 화면에서 사라져 갇힌다. 창을 다시 띄우고 닫기 요청(onClose)을 보낸다:
      // 부모가 닫으면 위 effect 가 정상적으로 닫고 정리하며, 닫지 않는 창은 그대로 남는다
      onClose={() => {
        const el = ref.current
        if (!el || !openRef.current || el.open) return
        try {
          el.showModal()
        } catch {
          /* 문서에서 빠진 창이면 다시 띄울 수 없다 */
        }
        onClose()
      }}
      // Tab 을 창 안에서만 돌게 한다. 크롬은 모달 창의 마지막 요소에서 Tab 을 누르면 포커스를 body 로 보내는데,
      // 그러면 낭독기가 "주요 내용 랜드마크"처럼 뒤 화면을 읽는다 (11-09 NVDA 실측, 버튼이 하나뿐인 단축키 안내 창)
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return
        const el = ref.current
        if (!el) return
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (n) => !n.hasAttribute('disabled') && n.getAttribute('aria-hidden') !== 'true',
        )
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        const current = document.activeElement
        if (e.shiftKey && (current === first || current === el)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (current === last || current === el)) {
          e.preventDefault()
          first.focus()
        }
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
          'flex justify-between gap-6',
          // 제목 한 줄뿐이면 닫기 버튼과 세로 가운데를 맞춘다. 설명·머리표가 있으면 위쪽 정렬
          kicker || description ? 'items-start' : 'items-center',
          longForm && 'sticky top-0 z-10 border-b-2 border-line bg-paper px-8 py-5',
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
            className={cn(
              'min-h-touch shrink-0 rounded-md border-2 border-navy px-4 font-bold text-navy',
              closeButtonClassName,
            )}
          >
            닫기
          </button>
        )}
      </div>
      {/* 이 창의 안내 영역. 창이 열려 있는 동안 안내(aria-live)가 여기에 쓰인다 */}
      <LiveRegions hostId={liveHostId} />
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
