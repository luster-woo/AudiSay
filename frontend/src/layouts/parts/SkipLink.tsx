import type { MouseEvent } from 'react'

/** 페이지 맨 앞의 "본문으로 건너뛰기". 평소엔 hidden, Tab 으로 포커스가 오면 나타난다 */
export function SkipLink() {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    document.getElementById('main')?.focus()
  }
  return (
    <a href="#main" className="skip-link" onClick={onClick}>
      본문으로 건너뛰기
    </a>
  )
}