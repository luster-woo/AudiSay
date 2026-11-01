import type { ReactNode } from 'react'
import { cn } from './cn'

export interface NoticeProps {
  title: string
  children?: ReactNode
  tone?: 'danger' | 'success'
  className?: string
}

const TONE = {
  danger: 'border-danger bg-danger-soft [&_h2]:text-danger',
  success: 'border-success bg-paper [&_h2]:text-success',
} as const

/**
 * 오류 요약·완료 안내 상자 (와이어프레임 '로그인하지 못했어요').
 * 낭독은 Announcer 가 맡으므로 이 상자에는 role="alert" 를 두지 않는다 (두 번 읽힘 방지).
 * 저시력 사용자가 눈으로 보는 용도이고, 빨간색만이 아니라 왼쪽 굵은 띠와 제목으로도 구분한다.
 */
export function Notice({ title, children, tone = 'danger', className }: NoticeProps) {
  return (
    <section
      aria-label={title}
      className={cn('rounded-md border-2 border-l-8 px-6 py-5', TONE[tone], className)}
    >
      <h2 className="text-lg font-bold">{title}</h2>
      {children && <div className="mt-2 text-ink">{children}</div>}
    </section>
  )
}
