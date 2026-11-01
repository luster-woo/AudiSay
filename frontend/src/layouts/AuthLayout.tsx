import { Outlet } from 'react-router-dom'
import { SkipLink } from './parts/SkipLink'
import { BrandLogo } from './parts/BrandLogo'
import { AnnounceBar } from './parts/AnnounceBar'

/** 로그인·회원가입: 로고만 있는 헤더 + 방금 안내 띠 + 본문 (주 메뉴 없음) */
export function AuthLayout() {
  return (
    <>
      <SkipLink />
      <header className="bg-paper">
        <div className="mx-auto flex min-h-18 max-w-[90rem] items-center px-16">
          <BrandLogo to="/landing" subtitle="화면해설 플레이어" />
        </div>
      </header>
      <AnnounceBar />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[90rem] px-16 pt-8 pb-16 outline-none">
        <Outlet />
      </main>
    </>
  )
}
