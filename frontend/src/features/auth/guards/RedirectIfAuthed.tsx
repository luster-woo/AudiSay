import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { redirectByRole, useAuth } from '../context'
import { SessionLoading } from './SessionLoading'

/** 랜딩·로그인·회원가입: 이미 로그인했으면 역할에 맞는 첫 화면으로 보낸다 */
export function RedirectIfAuthed() {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <SessionLoading />
  if (status === 'authenticated' && user) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={redirectByRole(user, from)} replace />
  }
  return <Outlet />
}
