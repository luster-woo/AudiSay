import { useId, useState } from 'react'
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
 * 736px(46rem) 미만 = 720px 이하·200% 확대에서는 '메뉴' 버튼(aria-expanded)으로 접고 편다 (원칙 10장).
 * 넓은 화면에서는 버튼이 없고 목록이 늘 보인다. 메뉴를 골라 화면을 옮기면 접힌다.
 */
export function MainNav() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const listId = useId()

  return (
    // 좁은 화면에서는 nav 의 상자를 없애(contents) 버튼과 목록이 헤더 줄에 직접 놓이게 한다
    <nav aria-label="주 메뉴" className="max-[46rem]:contents">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="hidden min-h-touch items-center rounded-md border-2 border-navy px-4 text-lg font-bold text-navy max-[46rem]:inline-flex"
      >
        {open ? '메뉴 닫기' : '메뉴'}
      </button>
      <ul
        id={listId}
        className={`flex items-center gap-1 max-[46rem]:basis-full max-[46rem]:flex-col max-[46rem]:items-stretch ${
          open ? '' : 'max-[46rem]:hidden'
        }`}
      >
        {NAV_ITEMS.map((item) => {
          const active = item.isActive(pathname)
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={`flex min-h-touch items-center border-b-4 px-4 text-lg font-bold ${
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
