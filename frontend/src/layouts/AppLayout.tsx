import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/context'
import { useShortcutEntry, useShortcutScope } from '@/features/shortcuts/context'
import { SkipLink } from './parts/SkipLink'
import { BrandLogo } from './parts/BrandLogo'
import { MainNav } from './parts/MainNav'
import { AnnounceBar } from './parts/AnnounceBar'
import { LogoutButton } from './parts/LogoutButton'

/** 로그인한 일반 사용자 화면: 헤더(로고·주 메뉴·이름·로그아웃) + 방금 안내 띠 + 본문 */
export function AppLayout() {
  const { user } = useAuth()
  const navigate = useNavigate()

  useShortcutScope('user')
  useShortcutEntry('home', () => navigate('/'), { scope: 'user' })

  return (
    <>
      <SkipLink />
      <header data-layout="user" className="bg-paper hc:border-b-2 hc:border-yellow">
        <div className="mx-auto flex min-h-18 max-w-[90rem] items-center justify-between gap-6 px-16">
          <BrandLogo subtitle="화면해설 플레이어" />
          <div className="flex items-center gap-6">
            <MainNav />
            {/* 이름은 글자, 로그아웃은 헤더의 마지막 조작 요소 */}
            <div className="flex items-center gap-4 border-l border-line pl-6">
              <p className="text-ink-muted">{user?.name} 님</p>
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>
      <AnnounceBar />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[90rem] px-16 pt-8 pb-16 outline-none">
        <Outlet />
      </main>
    </>
  )
}
