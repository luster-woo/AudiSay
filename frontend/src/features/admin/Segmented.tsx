import { useId } from 'react'
import { cn } from '@/components/ui/cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedProps<T extends string> {
  /** 묶음 이름 (legend). 화면에서 숨길 수도 있다 */
  legend: string
  hideLegend?: boolean
  options: readonly SegmentedOption<T>[]
  /** 어느 것도 고르지 않은 상태면 null */
  value: T | null
  onChange: (value: T) => void
  className?: string
}

/**
 * 붙어 있는 칸 여러 개 중 하나 고르기 (RoleFilter 와 같은 생김새, 높이 38px).
 * 라디오 묶음이라 ← → 로 옮기면 바로 바뀐다.
 */
export function Segmented<T extends string>({
  legend,
  hideLegend,
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) {
  const name = useId()
  return (
    <fieldset className={className}>
      <legend className={cn('text-[0.8667rem] text-ink-muted', hideLegend && 'sr-only')}>
        {legend}
      </legend>
      <div className={cn('flex', !hideLegend && 'mt-[0.5333rem]')}>
        {options.map((o, i) => (
          <label
            key={o.value}
            className={cn(
              'flex h-[2.5333rem] cursor-pointer items-center border-2 border-ink-muted/70 bg-paper px-[1rem] text-[0.9333rem] font-bold whitespace-nowrap text-ink',
              i > 0 && '-ml-[2px]',
              i === 0 && 'rounded-l-sm',
              i === options.length - 1 && 'rounded-r-sm',
              'has-[:checked]:relative has-[:checked]:border-navy has-[:checked]:bg-navy has-[:checked]:text-paper',
              'has-[:focus-visible]:relative has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy has-[:focus-visible]:outline-solid',
            )}
          >
            <input
              type="radio"
              name={name}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
