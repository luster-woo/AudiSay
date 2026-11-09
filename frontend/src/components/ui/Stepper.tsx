import { useId } from 'react'
import { useAnnouncer } from '@/features/announcer/context'
import { cn } from './cn'

export interface StepperProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  /** 화면 표시 (1.0배, 80%) */
  format?: (value: number) => string
  className?: string
  decreaseLabel?: string
  increaseLabel?: string
}

/**
 * − 값 + 조절기 (말하기 속도, 해설 소리 크기).
 * 버튼 두 개 + 값 표시로 만들고, 바뀐 값은 Announcer 로 한 번 읽는다.
 */
export function Stepper({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = String,
  className,
  decreaseLabel = `${label} 줄이기`,
  increaseLabel = `${label} 높이기`,
}: StepperProps) {
  const labelId = useId()
  const { announce } = useAnnouncer()
  const decimals = String(step).split('.')[1]?.length ?? 0

  const change = (delta: number) => {
    const next = Number(Math.min(max, Math.max(min, value + delta)).toFixed(decimals))
    if (next === value) {
      announce(`${label}, ${delta > 0 ? '가장 큰' : '가장 작은'} 값이에요. ${format(value)}.`)
      return
    }
    onChange(next)
    announce(`${label} ${format(next)}.`)
  }

  const btn = 'min-h-touch min-w-touch text-xl font-bold text-navy aria-disabled:opacity-40'

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn('flex items-center gap-4', className)}
    >
      <span id={labelId} className="font-bold text-ink">
        {label}
      </span>
      <div className="flex items-center rounded-md border-2 border-navy bg-paper">
        {/* 버튼 이름에 지금 값을 붙인다: 낭독기는 가운데 값 표시(output)를 Tab 으로 지나치지 않아 못 듣는다 (11-09 NVDA 실측) */}
        <button
          type="button"
          aria-label={`${decreaseLabel}, 지금 ${format(value)}`}
          aria-disabled={value <= min || undefined}
          onClick={() => change(-step)}
          className={btn}
        >
          −
        </button>
        <output className="min-w-20 text-center text-lg font-bold">{format(value)}</output>
        <button
          type="button"
          aria-label={`${increaseLabel}, 지금 ${format(value)}`}
          aria-disabled={value >= max || undefined}
          onClick={() => change(step)}
          className={btn}
        >
          +
        </button>
      </div>
    </div>
  )
}