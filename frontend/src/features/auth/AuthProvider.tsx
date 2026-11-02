import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { usersApi } from '@/api/users'
import { onSessionEvent, reissueAccessToken } from '@/api/client'
import { tokenStore } from '@/api/token'
import type { AuthUser, Me } from '@/api/types'
import { useAnnouncer } from '@/features/announcer/context'
import {
  AuthContext,
  redirectByRole,
  type AuthStatus,
  type AuthValue,
  type SessionUser,
} from './context'

function fromMe(me: Me): SessionUser {
  return { ...me, tutorialCompleted: null }
}
function fromLogin(u: AuthUser): SessionUser {
  return { ...u, verified: u.role === 'VISUALLY_IMPAIRED' }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { announce } = useAnnouncer()

  // ── 앱 시작: RefreshToken 쿠키로 AccessToken 재발급 → 내 정보 ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await reissueAccessToken()
        const me = await usersApi.me()
        if (!cancelled) {
          setUser(fromMe(me))
          setStatus('authenticated')
        }
      } catch {
        if (!cancelled) {
          tokenStore.clear()
          setUser(null)
          setStatus('anonymous')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ── client.ts 인터셉터가 세션 종료를 알리면 화면 쪽 처리 ──
  useEffect(() => {
    onSessionEvent((reason) => {
      if (reason === 'expired') {
        setUser(null)
        setStatus('anonymous')
        queryClient.clear()
        announce('로그인이 만료됐어요. 다시 로그인해 주세요.', { politeness: 'assertive' })
        navigate('/login', { replace: true, state: { from: location.pathname } })
      } else {
        announce('권한이 없어요.', { politeness: 'assertive' })
        navigate('/', { replace: true })
      }
    })
    return () => onSessionEvent(null)
  }, [announce, navigate, queryClient, location.pathname])

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await authApi.login(email, password)
      const next = fromLogin(result.user)
      setUser(next)
      setStatus('authenticated')
      const from = (location.state as { from?: string } | null)?.from
      navigate(redirectByRole(next, from), { replace: true })
      return next
    },
    [navigate, location.state],
  )

  const logout = useCallback(async () => {
    await authApi.logout()
    setUser(null)
    setStatus('anonymous')
    queryClient.clear() // 관리자 데이터가 다음 사용자에게 남지 않게
    announce('로그아웃했어요.')
    navigate('/landing', { replace: true })
  }, [announce, navigate, queryClient])

  const updateUser = useCallback((patch: Partial<SessionUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const value = useMemo<AuthValue>(
    () => ({ status, user, isAdmin: user?.role === 'ADMIN', login, logout, updateUser }),
    [status, user, login, logout, updateUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
