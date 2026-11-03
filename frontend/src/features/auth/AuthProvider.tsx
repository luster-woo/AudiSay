import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { usersApi } from '@/api/users'
import { onSessionEvent, reissueAccessToken } from '@/api/client'
import { tokenStore } from '@/api/token'
import { queryKeys } from '@/api/queryKeys'
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
  // 응답에 값이 빠져 오면(undefined) 모름(null)으로 둔다
  const tutorialCompleted = typeof u.tutorialCompleted === 'boolean' ? u.tutorialCompleted : null
  return { ...u, tutorialCompleted, verified: u.role === 'VISUALLY_IMPAIRED' }
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
      // 사용법을 볼지는 로그인 응답의 tutorialCompleted 가 1순위.
      // 응답에 값이 없을 때만 재생 설정(GET /users/me/settings)의 값으로 판단한다.
      // 받은 설정은 캐시에 넣어 SettingsProvider 가 다시 부르지 않게 한다
      if (next.role !== 'ADMIN' && next.tutorialCompleted === null) {
        try {
          const settings = await queryClient.fetchQuery({
            queryKey: queryKeys.settings,
            queryFn: usersApi.settings,
            staleTime: 0,
          })
          if (typeof settings.tutorialCompleted === 'boolean') {
            next.tutorialCompleted = settings.tutorialCompleted
          }
        } catch {
          // 설정을 못 받으면 로그인 응답 값으로 판단한다
        }
      }
      setUser(next)
      setStatus('authenticated')
      const from = (location.state as { from?: string } | null)?.from
      navigate(redirectByRole(next, from), { replace: true })
      return next
    },
    [navigate, location.state, queryClient],
  )

  const endSession = useCallback(
    async (message: string) => {
      tokenStore.clear()
      setUser(null)
      // 이동 중 보호 라우트가 /login 으로 보내지 않게 한 번에 세션을 끝낸다.
      setStatus('loading')
      queryClient.clear() // 관리자 데이터가 다음 사용자에게 남지 않게
      try {
        await navigate('/landing', { replace: true, flushSync: true })
      } finally {
        setStatus('anonymous')
        announce(message)
      }
    },
    [announce, navigate, queryClient],
  )

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      // authApi 는 실패해도 토큰을 비운다. 화면 상태·개인정보 캐시도 함께 비운다.
      await endSession('로그아웃했어요.')
    }
  }, [endSession])

  const updateUser = useCallback((patch: Partial<SessionUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      isAdmin: user?.role === 'ADMIN',
      login,
      logout,
      endSession,
      updateUser,
    }),
    [status, user, login, logout, endSession, updateUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
