import { useId } from 'react'
import type { Role } from '@/api/types'
import { cn } from '@/components/ui/cn'
import { ROLE_LABELS } from './users'

export interface RoleFilterProps {
  /** undefined 면 전체 */
  value: Role | undefined
  onChange: (value: Role | undefined) => void
}

const OPTIONS: { value: Role | undefined; label: string }[] = [
  { value: undefined, label: '전체' },
  // 관리자는 계정이 하나라 거르는 칸이 없다 (Figma). '전체'에는 함께 나온다
  ...(['GENERAL', 'VISUALLY_IMPAIRED'] as const).map((r) => ({
    value: r,
    label: ROLE_LABELS[r],
  })),
]

/**
 * 역할로 거르기 (Figma 붙어 있는 세 칸, 높이 38px).
 * 라디오 묶음이라 ← → 로 옮기면 바로 바뀐다.
 */
export function RoleFilter({ value, onChange }: RoleFilterProps) {
  const name = useId()
  return (
    <fieldset>
      <legend className="text-[0.8667rem] text-ink-muted">역할</legend>
      <div className="mt-[0.5333rem] flex">
        {OPTIONS.map((o, i) => (
          <label
            key={o.label}
            className={cn(
              'flex h-[2.5333rem] cursor-pointer items-center border-2 border-ink-muted/70 bg-paper px-[1rem] text-[0.9333rem] font-bold text-ink',
              i > 0 && '-ml-[2px]',
              i === 0 && 'rounded-l-sm',
              i === OPTIONS.length - 1 && 'rounded-r-sm',
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
