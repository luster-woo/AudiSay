import { Link, useLocation } from 'react-router-dom'

interface NavItem {
  to: string
  label: string
  /* 이 메뉴를 '현재 위치'로 볼 경로 */
  isActive: (path: string) => boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '홈', isActive: (p) => p === '/' || p.startsWith('/search') },
  {
    to: '/register',
    label: '영상 등록',
    isActive: (p) => /^\/(register|upload|jobs)(\/|$)/.test(p),
  },
  { to: '/me/videos', label: '내 영상', isActive: (p) => p.startsWith('/me/videos') },
  { to: '/me', label: '내 정보', isActive: (p) => p === '/me' || p.startsWith('/verify') },
  { to: '/help', label: '도움말', isActive: (p) => p.startsWith('/help') },
]
    
/**
 * 주 메뉴. NavLink 대신 직접 aria-current 를 계산한다:
 * 경로 접두사가 다른 경우가 있어 직접 계산.
 */
export function MainNav() {
  const { pathname } = useLocation()

  return (
    <nav aria-label="주 메뉴">
      <ul className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.isActive(pathname)
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-touch items-center border-b-4 px-4 font-bold ${
                  active ? 'border-navy text-navy' : 'border-transparent text-ink'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}