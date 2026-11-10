import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AnnouncerProvider } from '@/features/announcer/AnnouncerProvider'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { SettingsProvider } from '@/features/settings/SettingsProvider'
import { ShortcutProvider } from '@/features/shortcuts/ShortcutProvider'
import { GlobalShortcuts } from '@/features/shortcuts/GlobalShortcuts'

/**
 * index.html 은 /landing 새로고침 때 <html data-page="landing"> (남색 바탕)을 먼저 붙이고, 지우는 건 LandingPage 가 떠날 때다.
 * 로그인 상태로 /landing 을 열면 RedirectIfAuthed 가 LandingPage 를 그리지 않고 다른 화면으로 보내서
 * 표시가 지워지지 않고 남아, 다른 화면 바탕까지 남색으로 칠해졌다. 주소가 바뀔 때마다 랜딩이 아니면 지운다
 */
function LandingBackgroundCleanup() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (pathname !== '/landing') delete document.documentElement.dataset.page
  }, [pathname])
  return null
}

/** 순서가 중요: Announcer 가 가장 바깥(Auth 가 announce 를 씀), Settings 는 Auth 의 status 를 씀 */
export function RootProviders() {
  return (
    <AnnouncerProvider>
      <LandingBackgroundCleanup />
      <AuthProvider>
        <SettingsProvider>
          <ShortcutProvider>
            <GlobalShortcuts />
            <Outlet />
          </ShortcutProvider>
        </SettingsProvider>
      </AuthProvider>
    </AnnouncerProvider>
  )
}
