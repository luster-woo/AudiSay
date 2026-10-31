import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/features/auth/context'
import { useShortcutScope } from '@/features/shortcuts/context'
import { SkipLink } from './parts/SkipLink'
import { AdminBreadcrumb } from './parts/AdminBreadCrumb'

interface AdminNavItem {
  to: string
  label: string
  /** 처리 전 건수 등. 화면엔 숫자만, 낭독기엔 "처리 전 12건" 으로 읽힌다 */
  badge?: { count: number; spoken: string }
}

// TODO(관리자 페이지 작업 시): 신고 처리 badge 를 신고 목록 API 의 처리 전 건수로 채운다
const ADMIN_NAV: AdminNavItem[] = [
  { to: '/admin/reports', label: '신고 처리' },
  { to: '/admin/videos', label: '해설 검수' },
  { to: '/admin/users', label: '회원' },
]

/**
 * 관리자 화면: 왼쪽 사이드바 + 본문. 방금 안내 띠는 없지만
 * AnnouncerProvider 의 live 영역은 그대로 있어서 announce() 는 낭독된다.
 */
export function AdminLayout() {
  const { user, logout } = useAuth()
  useShortcutScope('admin')

  // 남색 사이드바 위 포커스 링은 노란색으로
  const onSidebarFocus = 'focus-visible:bg-navy-deep focus-visible:outline-yellow'

  return (
    <>
      <SkipLink />
      <div className="flex min-h-svh">
        <aside className="flex w-72 shrink-0 flex-col bg-sidebar px-5 py-8 text-on-sidebar">
          <p className="px-3 text-2xl font-bold">
            AudiSay <span className="block text-sm font-normal opacity-80">운영 관리</span>
          </p>

          <nav aria-label="운영 관리 메뉴" className="mt-8">
            <ul className="space-y-2">
              {ADMIN_NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `flex min-h-touch items-center justify-between rounded-md px-4 text-lg ${onSidebarFocus} ${
                        isActive ? 'bg-yellow font-bold text-navy' : 'text-on-sidebar'
                      }`
                    }
                  >
                    {item.label}
                    {item.badge && (
                      <>
                        <span aria-hidden="true">{item.badge.count}</span>
                        <span className="sr-only">, {item.badge.spoken}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-auto border-t border-on-sidebar/20 px-3 pt-5">
            <p>{user?.name} · 운영자</p>
            <button
              type="button"
              onClick={logout}
              className={`mt-2 rounded-sm font-bold text-on-sidebar ${onSidebarFocus}`}
            >
              로그아웃
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-cream">
          <AdminBreadcrumb />
          <main id="main" tabIndex={-1} className="flex-1 px-8 py-8 outline-none">
            <Outlet />
          </main>
        </div>
      </div>
    </>
  )
}