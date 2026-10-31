import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './cn'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  panel: ReactNode
}

export interface TabsProps<T extends string> {
  label: string
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

/**
 * 탭 (관리자 장면/신고, 처리 전/완료/반려).
 * Tab 키로는 선택된 탭 하나에만 멈추고(roving tabindex), 탭 사이는 ← → Home End 로 옮긴다.
 * 옮기면 바로 선택된다(자동 활성화).
 */
export function Tabs<T extends string>({ label, items, value, onChange, className }: TabsProps<T>) {
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

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="flex gap-1 border-b-2 border-line">
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
              className={cn(
                '-mb-0.5 min-h-touch border-b-4 px-5 font-bold',
                selected ? 'border-navy text-ink' : 'border-transparent text-ink-muted',
              )}
            >
              {it.label}
            </button>
          )
        })}
      </div>
      {active && (
        <div
          role="tabpanel"
          id={panelId(active.value)}
          aria-labelledby={tabId(active.value)}
          className="pt-6"
        >
          {active.panel}
        </div>
      )}
    </div>
  )
}