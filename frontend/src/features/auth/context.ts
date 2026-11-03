import { createContext, useContext } from 'react'
import type { Role } from '@/api/types'

/** 로그인 응답(AuthUser)과 복원 응답(Me)을 합친 세션 사용자 */
export interface SessionUser {
  userId: number
  email: string
  name: string
  role: Role
  verified: boolean
  tutorialCompleted: boolean | null
}

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthValue {
  status: AuthStatus
  user: SessionUser | null
  isAdmin: boolean
  login: (email: string, password: string) => Promise<SessionUser>
  logout: () => Promise<void>
  /** 서버에서 탈퇴가 끝난 뒤 로컬 세션도 즉시 비운다 */
  endSession: (message: string) => Promise<void>
  /** 인증·튜토리얼 완료처럼 세션 사용자 정보 일부가 바뀌었을 때 */
  updateUser: (patch: Partial<SessionUser>) => void
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 는 AuthProvider 안에서만 쓸 수 있어요')
  return ctx
}

/** 로그인 직후 이동할 경로 설정 */
export function redirectByRole(user: SessionUser, from?: string): string {
  if (user.role === 'ADMIN') return '/admin/reports'
  if (user.tutorialCompleted === false) return '/tutorial/1'
  return from && from !== '/login' ? from : '/'
}
