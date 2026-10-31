import { useRef } from 'react'
import { useMatches } from 'react-router-dom'
import type { RouteHandle } from '@/app/routeHandle'
import { usePageEntry } from '@/features/page/usePageEntry'

/**
 * 아직 만들지 않은 화면 자리. 라우트 handle 의 title/announce 로 진입 처리까지 한다.
 * 실제 페이지를 만들면 router.tsx 에서 이 컴포넌트를 바꿔 끼운다.
 * 규칙: 페이지는 <main> 을 그리지 않는다. 최상위는 <h1> 부터.
 */
export default function PlaceholderPage() {
  const matches = useMatches()
  const handle = matches.at(-1)?.handle as RouteHandle | undefined
  const title = handle?.title ?? '준비 중'
  const headingRef = useRef<HTMLHeadingElement>(null)

  usePageEntry({
    title,
    announce: handle?.announce ?? `${title} 화면이에요.`,
    focusRef: headingRef,
  })

  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="text-4xl font-bold text-ink outline-none">
        {title}
      </h1>
      <p className="mt-3 text-ink-muted">이 화면은 아직 만드는 중이에요.</p>
    </>
  )
}