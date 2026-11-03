import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  spoken: string
}

// 정적 본문에서는 aria-label 대신 실제 숨긴 텍스트를 제공해 스캔 모드에서도 읽힌다.
export function HelpReadableText({ children, spoken }: Props) {
  if (children === spoken) return children

  return (
    <>
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{spoken}</span>
    </>
  )
}
