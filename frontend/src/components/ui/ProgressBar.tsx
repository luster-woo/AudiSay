import { cn } from './cn'

export interface ProgressBarProps {
  /** 0 ~ 100 */
  value: number
  /** 낭독기용 이름 ("해설 만들기 진행률") */
  label: string
  /** 낭독기가 숫자 대신 읽을 문구 ("50퍼센트, 약 1분 20초 남음") */
  valueText?: string
  className?: string
}

/**
 * 진행 막대. 읽는 시점(단계 변경·10% 단위)은 useProgressAnnounce 가 정한다.
 */
export function ProgressBar({ value, label, valueText, className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
      className={cn('h-4 overflow-hidden rounded-full bg-line', className)}
    >
      <div className="h-full rounded-full bg-navy" style={{ width: `${clamped}%` }} />
    </div>
  )
}