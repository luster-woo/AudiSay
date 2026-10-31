import type { ReactNode } from 'react'
import { cn } from './cn'

export interface BadgeProps {
  children: ReactNode
  /** 화면 글자 대신 낭독기가 읽을 문구 ("신고 3" → "신고 3건") */
  spoken?: string
  tone?: 'accent' | 'danger' | 'neutral'
  className?: string
}

const TONE = {
  accent: 'bg-yellow text-navy',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-line text-ink',
} as const

/** 작은 표시 딱지 (신고 3, 처리 전 12) */
export function Badge({ children, spoken, tone = 'accent', className }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex rounded-full px-3 py-0.5 text-sm font-bold', TONE[tone], className)}
    >
      {spoken ? (
        <>
          <span aria-hidden="true">{children}</span>
          <span className="sr-only">{spoken}</span>
        </>
      ) : (
        children
      )}
    </span>
  )
}