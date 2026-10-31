import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  label: ReactNode
  indeterminate?: boolean
}

export function Checkbox({ label, indeterminate = false, className, ...rest }: CheckboxProps) {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)

  // indeterminate 는 HTML 속성이 없고 DOM 프로퍼티로만 켤 수 있다
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <div className={cn('flex min-h-touch items-center gap-3', className)}>
      <input ref={ref} id={id} type="checkbox" className="size-6 shrink-0 accent-navy" {...rest} />
      <label htmlFor={id} className="text-ink">
        {label}
      </label>
    </div>
  )
}