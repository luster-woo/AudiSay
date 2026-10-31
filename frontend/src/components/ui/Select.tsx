import { useId, type SelectHTMLAttributes } from 'react'
import { cn } from './cn'

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string
  hideLabel?: boolean
  options: { value: string; label: string }[]
}

/** 브라우저 기본 select */
export function Select({ label, hideLabel = false, options, className, ...rest }: SelectProps) {
  const id = useId()
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'font-bold text-ink'}>
        {label}
      </label>
      <select
        id={id}
        className="min-h-touch rounded-md border-2 border-navy bg-paper px-4 text-lg text-ink"
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}