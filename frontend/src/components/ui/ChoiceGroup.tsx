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
  /** 보기 하나하나의 폭·여백 (옆 버튼들과 크기를 맞출 때). 없으면 글자 길이만큼 */
  optionClassName?: string
  /**
   * buttons: 테두리 버튼이 하나씩 떨어져 있다 (기본) ·
   * segmented: 테두리 하나 안에 보기들이 붙어 있는 한 덩어리 (영상 화면 해설 상세도)
   */
  appearance?: 'buttons' | 'segmented'
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
  optionClassName,
  appearance = 'buttons',
}: ChoiceGroupProps<T>) {
  const name = useId()
  const segmented = appearance === 'segmented'

  return (
    <fieldset className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      <legend className={hideLegend ? 'sr-only' : 'float-left mr-4 font-bold text-ink'}>
        {legend}
      </legend>
      <div
        className={cn(
          segmented
            ? 'inline-flex flex-wrap gap-1 rounded-lg border-2 border-navy bg-paper p-1'
            : 'flex flex-wrap gap-2',
        )}
      >
        {options.map((o) => (
          <label
            key={String(o.value)}
            className={cn(
              'flex cursor-pointer items-center justify-center font-bold whitespace-nowrap text-navy',
              segmented
                ? 'min-h-11 rounded-md hover:bg-cream'
                : 'min-h-touch rounded-md border-2 border-navy bg-paper has-[:checked]:border-4',
              optionClassName ?? 'px-4',
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
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
