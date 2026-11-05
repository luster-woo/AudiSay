import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './cn'
import { buttonClass } from './buttonStyles'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  panel: ReactNode
}

export interface TabsProps<T extends string> {
  /** 탭 묶음 이름 (낭독기용) */
  label: string
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  /** underline: 밑줄 탭(관리자) · buttons: 테두리 버튼 세 개가 나란히 (시청 화면 목차·대본·질문 기록) */
  appearance?: 'underline' | 'buttons'
  /** sm: 관리자 화면의 탭 (18px, 밑줄 2px). 기본 md */
  size?: 'md' | 'sm'
  /** 탭 패널 위쪽 여백을 바꿀 때 */
  panelClassName?: string
  className?: string
  variant?: 'underline' | 'pills'
  tabListClassName?: string
  /** 탭 목록 바로 뒤에 둘 화면 이동 링크 등. 탭 역할에는 포함하지 않는다. */
  navigationEnd?: ReactNode
}

/**
 * 탭 (관리자 장면/신고, 처리 전/완료/반려).
 * Tab 키로는 선택된 탭 하나에만 멈추고(roving tabindex), 탭 사이는 ← → Home End 로 옮긴다.
 * 옮기면 바로 선택된다(자동 활성화).
 */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  appearance = 'underline',
  size = 'md',
  panelClassName,
  className,
  variant = 'underline',
  tabListClassName,
  navigationEnd,
}: TabsProps<T>) {
  const buttons = appearance === 'buttons'
  const pills = variant === 'pills'
  const baseId = useId()
  const tabRefs = useRef(new Map<T, HTMLButtonElement>())
  const tabId = (v: T) => `${baseId}-tab-${v}`
  const panelId = (v: T) => `${baseId}-panel-${v}`

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = items.findIndex((it) => it.value === value)
    const last = items.length - 1
    const next =
      e.key === 'ArrowRight'
        ? i === last
          ? 0
          : i + 1
        : e.key === 'ArrowLeft'
          ? i === 0
            ? last
            : i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null
    if (next === null) return
    e.preventDefault()
    const v = items[next].value
    onChange(v)
    tabRefs.current.get(v)?.focus()
  }

  const active = items.find((it) => it.value === value)

  const tabList = (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        pills
          ? 'flex flex-wrap gap-4'
          : buttons
            ? 'grid grid-cols-3 gap-2'
            : 'flex gap-1 border-b-2 border-line',
        tabListClassName,
      )}
    >
      {items.map((it) => {
        const selected = it.value === value
        return (
          <button
            key={it.value}
            ref={(el) => {
              if (el) tabRefs.current.set(it.value, el)
              else tabRefs.current.delete(it.value)
            }}
            type="button"
            role="tab"
            id={tabId(it.value)}
            aria-selected={selected}
            aria-controls={panelId(it.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(it.value)}
            onKeyDown={onKeyDown}
            className={
              pills
                ? buttonClass(selected ? 'primary' : 'secondary', 'xl', 'px-6')
                : cn(
                    buttons
                      ? 'min-h-touch rounded-md border-2 border-navy px-4 text-lg font-bold'
                      : '-mb-0.5 font-bold',
                    !buttons &&
                      (size === 'sm'
                        ? 'min-h-12 border-b-2 px-4 text-[1.2rem]'
                        : 'min-h-touch border-b-4 px-5'),
                    buttons
                      ? selected
                        ? 'bg-navy text-cream focus-visible:bg-navy-deep'
                        : 'bg-paper text-navy'
                      : selected
                        ? 'border-navy text-ink'
                        : 'border-transparent text-ink-muted',
                  )
            }
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className={className}>
      {navigationEnd ? (
        <div className="flex flex-wrap items-center gap-4">
          {tabList}
          {navigationEnd}
        </div>
      ) : (
        tabList
      )}
      {active && (
        <div
          role="tabpanel"
          id={panelId(active.value)}
          aria-labelledby={tabId(active.value)}
          className={panelClassName ?? 'pt-6'}
        >
          {active.panel}
        </div>
      )}
    </div>
  )
}
