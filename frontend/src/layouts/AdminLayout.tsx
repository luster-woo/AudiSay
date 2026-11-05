import { useState } from 'react'
import { NavLink, Outlet, useMatches } from 'react-router-dom'
import type { RouteHandle } from '@/app/routeHandle'
import { useAuth } from '@/features/auth/context'
import { usePendingReportCount } from '@/features/admin/usePendingReportCount'
import { useShortcutScope } from '@/features/shortcuts/context'
import { LogoMark } from './parts/LogoMark'
import { SkipLink } from './parts/SkipLink'
import { AdminBreadcrumb } from './parts/AdminBreadCrumb'
import { AdminTopbarContext } from './parts/adminTopbar'

interface AdminNavItem {
  to: string
  label: string
  /** 처리 전 건수 등. 화면엔 숫자만, 낭독기엔 "처리 전 12건" 으로 읽힌다 */
  badge?: { count: number; spoken: string }
}

const ADMIN_NAV: AdminNavItem[] = [
  { to: '/admin/reports', label: '신고 처리' },
  { to: '/admin/stats', label: '통계' },
  { to: '/admin/chat-stats', label: '챗봇 품질 통계' },
  { to: '/admin/users', label: '회원' },
]

/**
 * 관리자 화면: 왼쪽 사이드바 + 본문. 방금 안내 띠는 없지만
 * AnnouncerProvider 의 live 영역은 그대로 있어서 announce() 는 낭독된다.
 */
export function AdminLayout() {
  const { user, logout } = useAuth()
  useShortcutScope('admin')
  const pendingCount = usePendingReportCount()
  const [topbar, setTopbar] = useState<HTMLDivElement | null>(null)
  // 위쪽 줄(현재 위치·처리 상태)은 crumb 가 있는 화면만. 회원 화면은 Figma 에 위쪽 줄이 없다
  const hasTopbar = useMatches().some((m) => (m.handle as RouteHandle | undefined)?.crumb)
  const nav = ADMIN_NAV.map((item) =>
    item.to === '/admin/reports' && pendingCount
      ? { ...item, badge: { count: pendingCount, spoken: `처리 전 ${pendingCount}건` } }
      : item,
  )

  // 남색 사이드바 위 포커스 링은 노란색으로
  const onSidebarFocus = 'focus-visible:bg-navy-deep focus-visible:outline-yellow'

  return (
    <>
      <SkipLink />
      {/* 관리자 화면은 고대비 대상이 아니다(원칙 12장). index.css 가 이 표시로 고대비 색을 끈다 */}
      <div data-layout="admin" className="flex min-h-svh">
        {/* 치수는 Figma 관리자 프레임 기준 (관리자 글자 크기 15px = 1rem) */}
        <aside className="sticky top-0 flex h-svh w-[15.4667rem] shrink-0 flex-col bg-sidebar px-[1.0667rem] pt-[1.5rem] pb-[1.3667rem] text-on-sidebar">
          <p className="px-[0.4rem] text-[1.6rem] leading-tight font-bold">
            <span className="flex items-center gap-[0.5rem]">
              <LogoMark />
              AudiSay
            </span>{' '}
            <span className="mt-[0.6rem] block text-[0.8667rem] font-normal opacity-80">운영 관리</span>
          </p>

          <nav aria-label="운영 관리 메뉴" className="mt-[2.2rem]">
            <ul className="space-y-[0.2667rem]">
              {nav.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `flex h-[2.9333rem] items-center justify-between rounded-sm px-[0.9333rem] text-[0.9333rem] ${onSidebarFocus} ${
                        isActive ? 'bg-yellow font-bold text-navy' : 'text-on-sidebar'
                      }`
                    }
                  >
                    {item.label}
                    {item.badge && (
                      <>
                        <span aria-hidden="true" className="text-[0.8667rem]">
                          {item.badge.count}
                        </span>
                        <span className="sr-only">, {item.badge.spoken}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* 사용자·로그아웃은 사이드바 맨 아래 (사이드바는 화면 높이에 고정) */}
          <div className="mt-auto border-t border-on-sidebar/20 px-[0.4rem] pt-[0.8867rem] text-[0.9333rem]">
            <p>{user?.name} · 운영자</p>
            <button
              type="button"
              onClick={logout}
              className={`mt-[0.7rem] min-h-0 rounded-sm font-bold text-on-sidebar ${onSidebarFocus}`}
            >
              로그아웃
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-cream">
          {hasTopbar && (
            <div className="relative h-[3.2rem] shrink-0 border-b border-line bg-paper">
              <AdminBreadcrumb />
              <div
                ref={setTopbar}
                className="absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center"
              />
            </div>
          )}
          <main id="main" tabIndex={-1} className="flex-1 px-8 py-8 outline-none">
            <AdminTopbarContext.Provider value={topbar}>
              <Outlet />
            </AdminTopbarContext.Provider>
          </main>
        </div>
      </div>
    </>
  )
}
