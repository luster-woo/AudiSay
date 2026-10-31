import { useId, type ReactNode } from 'react'
import { cn } from './cn'

export interface ChoiceOption<T extends string | number> {
  value: T
  label: ReactNode
}

export interface ChoiceGroupProps<T extends string | number> {
  /** 묶음 이름 (해설 상세도, 역할) */
  legend: string
  hideLegend?: boolean
  options: ChoiceOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

/**
 * 하나만 고르는 버튼 묶음 (와이어프레임의 [1 짧게][2 기본][3 자세히]).
 * 낭독기가 "해설 상세도, 2 기본, 라디오 버튼, 선택됨, 3개 중 2번째" 처럼 읽는다.
 */
export function ChoiceGroup<T extends string | number>({
  legend,
  hideLegend = false,
  options,
  value,
  onChange,
  className,
}: ChoiceGroupProps<T>) {
  const name = useId()

  return (
    <fieldset className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      <legend className={hideLegend ? 'sr-only' : 'float-left mr-4 font-bold text-ink'}>
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={String(o.value)}
            className={cn(
              'flex min-h-touch cursor-pointer items-center rounded-md border-2 border-navy bg-paper px-4 font-bold text-navy',
              'has-[:checked]:bg-navy has-[:checked]:text-cream',
              'has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy has-[:focus-visible]:outline-solid',
            )}
          >
            <input
              type="radio"
              name={name}
              value={String(o.value)}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span aria-hidden="true" className="mr-1 hidden peer-checked:inline">
              ✓
            </span>
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}