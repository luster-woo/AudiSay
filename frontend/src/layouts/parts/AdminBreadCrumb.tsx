import { useMatches } from 'react-router-dom'
import type { RouteHandle } from '@/app/routeHandle'
export function AdminBreadcrumb() {
  const matches = useMatches()
  const crumb = [...matches].reverse().find((m) => (m.handle as RouteHandle | undefined)?.crumb)
  const label = (crumb?.handle as RouteHandle | undefined)?.crumb
  if (!label) return null

  return (
    <nav aria-label="현재 위치" className="flex h-full items-center px-[1.6rem]">
      <ol className="flex items-center gap-[1.2rem] text-[0.8667rem] text-ink-muted">
        <li>운영 관리</li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="font-bold text-ink">
          {label}
        </li>
      </ol>
    </nav>
  )
}