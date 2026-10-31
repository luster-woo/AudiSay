import { Outlet } from 'react-router-dom'
import { AnnouncerProvider } from '@/features/announcer/AnnouncerProvider'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { SettingsProvider } from '@/features/settings/SettingsProvider'
import { ShortcutProvider } from '@/features/shortcuts/ShortcutProvider'
import { GlobalShortcuts } from '@/features/shortcuts/GlobalShortcuts'

/** 순서가 중요: Announcer 가 가장 바깥(Auth 가 announce 를 씀), Settings 는 Auth 의 status 를 씀 */
export function RootProviders() {
  return (
    <AnnouncerProvider>
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
