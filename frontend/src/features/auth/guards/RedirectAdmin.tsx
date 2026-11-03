import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context'

/**
 * 일반 사용자 화면: 관리자는 관리자 첫 화면으로 보낸다.
 * 관리자로 로그인한 채 사이트를 다시 열면(세션 복원) 첫 주소가 '/' 라서 사용자 홈이 열리던 문제를 막는다.
 */
export function RedirectAdmin() {
  const { user } = useAuth()
  if (user?.role === 'ADMIN') return <Navigate to="/admin/reports" replace />
  return <Outlet />
}
