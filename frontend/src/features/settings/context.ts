import { createContext, useContext } from 'react'
import type { UserSettings } from '@/api/types'

export interface SettingsValue {
  settings: UserSettings
  /** 비로그인이거나 서버 설정을 받아온 뒤 상태 */
  isLoaded: boolean
  /** 바꿀 필드만 넘긴다. 로그인 상태면 PATCH, 아니면 로컬에만 반영 */
  update: (patch: Partial<UserSettings>) => Promise<void>
}

export const SettingsContext = createContext<SettingsValue | null>(null)

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings 는 SettingsProvider 안에서만 쓸 수 있어요')
  return ctx
}
