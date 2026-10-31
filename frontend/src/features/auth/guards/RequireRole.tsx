import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import type { Role } from '@/api/types'
import { useAnnouncer } from '@/features/announcer/context'
import { useAuth } from '../context'

/**
 * 특정 역할만 들어갈 수 있는 화면.
 * prop 이름을 role 로 하면 jsx-a11y 가 ARIA role 로 오인해서 allow 로 지었다.
 */
export function RequireRole({ allow }: { allow: Role }) {
  const { user } = useAuth()
  const { announce } = useAnnouncer()
  const allowed = user?.role === allow

  useEffect(() => {
    if (!allowed) announce('관리자만 들어갈 수 있어요.', { politeness: 'assertive' })
  }, [allowed, announce])

  if (!allowed) return <Navigate to="/" replace />
  return <Outlet />
}