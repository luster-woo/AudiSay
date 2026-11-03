import { useId } from 'react'
import type { ReportStatus } from '@/api/types'
import { cn } from '@/components/ui/cn'
import { STATUS_LABELS } from './reports'

export interface StatusSwitchProps {
  value: ReportStatus
  onChange: (value: ReportStatus) => void
  pendingCount?: number
}

const STATUSES: ReportStatus[] = ['PENDING', 'RESOLVED', 'REJECTED']

/**
 * 처리 전 / 처리 완료 / 반려 (Figma 위쪽 줄 가운데 300×32 알약).
 * 라디오 묶음이라 ← → 로 옮기면 바로 바뀐다.
 */
export function StatusSwitch({ value, onChange, pendingCount }: StatusSwitchProps) {
  const name = useId()
  return (
    <fieldset className="flex h-[2.1333rem] w-[20rem] rounded-full bg-cream p-[0.1333rem]">
      <legend className="sr-only">처리 상태</legend>
      {STATUSES.map((s) => (
        <label
          key={s}
          className={cn(
            'flex flex-1 cursor-pointer items-center justify-center gap-[0.6rem] rounded-full text-[0.8667rem] text-ink-muted',
            'has-[:checked]:bg-paper has-[:checked]:font-bold has-[:checked]:text-ink has-[:checked]:shadow-sm',
            'has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy has-[:focus-visible]:outline-solid',
          )}
        >
          <input
            type="radio"
            name={name}
            value={s}
            checked={s === value}
            onChange={() => onChange(s)}
            className="sr-only"
          />
          {STATUS_LABELS[s]}
          {s === 'PENDING' && pendingCount !== undefined && (
            <span className="font-bold text-navy">
              {pendingCount}
              <span className="sr-only">건</span>
            </span>
          )}
        </label>
      ))}
    </fieldset>
  )
}
