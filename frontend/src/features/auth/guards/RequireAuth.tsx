import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context'
import { SessionLoading } from './SessionLoading'

/**
 * 로그인해야 들어갈 수 있는 화면.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <SessionLoading />
  if (status === 'anonymous') {
    // 사이트 첫 진입('/')은 랜딩으로, 그 외 주소는 로그인 후 원래 자리로 돌아오게
    const to = location.pathname === '/' ? '/landing' : '/login'
    return <Navigate to={to} replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}
