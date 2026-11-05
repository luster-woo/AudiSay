import { useId, type SelectHTMLAttributes } from 'react'
import { cn } from './cn'

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string
  hideLabel?: boolean
  options: { value: string; label: string }[]
}

/**
 * 브라우저 기본 select (낭독기·키보드 동작은 그대로).
 * 기본 화살표는 위치·크기를 바꿀 수 없어 숨기고, 같은 자리에 더 큰 화살표를 그린다 (장식이라 낭독기에는 숨김)
 */
export function Select({ label, hideLabel = false, options, className, ...rest }: SelectProps) {
  const id = useId()
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'font-bold text-ink'}>
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          className="min-h-touch w-full appearance-none rounded-md border-2 border-navy bg-paper pr-14 pl-4 text-lg text-ink"
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="pointer-events-none absolute top-1/2 right-5 size-6 -translate-y-1/2 text-navy"
          fill="none"
        >
          <path
            d="M5 9l7 7 7-7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}
