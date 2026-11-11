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
  useShortcutEntry('tutorial', () => navigate('/tutorial/1'), { scope: 'user' })

  return (
    <>
      <SkipLink />
      <header data-layout="user" className="bg-paper hc:border-b-2 hc:border-yellow">
        {/* 736px(46rem) 미만 = 720px 이하·200% 확대: 줄을 바꾸고 주 메뉴는 '메뉴' 버튼으로 접는다 (원칙 10장). 양옆 여백도 줄인다 */}
        {/* 글자 크기 5단계에서는 구조는 그대로 두고 여백·간격만 줄여 한 줄에 들어가게 한다 (한 줄 폭 약 64.7rem → 55rem) */}
        <div className="mx-auto flex min-h-18 max-w-[90rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 sm:px-8 lg:px-16 fs5:gap-x-4 fs5:lg:px-8">
          <BrandLogo subtitle="화면해설 플레이어" />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 max-[46rem]:w-full fs5:gap-x-4">
            <MainNav />
            {/* 이름은 글자, 로그아웃은 헤더의 마지막 조작 요소 */}
            <div className="flex items-center gap-4 border-l border-line pl-6 max-[46rem]:border-l-0 max-[46rem]:pl-0 fs5:gap-3 fs5:min-[46rem]:pl-4">
              <p className="text-3xl text-ink-muted">{user?.name} 님</p>
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>
      <AnnounceBar />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-[90rem] px-4 pt-8 pb-16 outline-none sm:px-8 lg:px-16"
      >
        <Outlet />
      </main>
    </>
  )
}
