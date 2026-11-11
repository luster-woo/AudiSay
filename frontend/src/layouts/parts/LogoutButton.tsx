import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useAnnouncer } from '@/features/announcer/context'
import { useAuth } from '@/features/auth/context'

/**
 * 헤더의 로그아웃 (사용자 이름 오른쪽). 확인 창 없이 바로 나가고,
 * '로그아웃했어요' 안내와 랜딩 이동은 AuthProvider 가 맡는다. 두 번 눌러도 한 번만 요청한다.
 */
export function LogoutButton() {
  const { logout } = useAuth()
  const { announce } = useAnnouncer()
  const busy = useRef(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const signOut = async () => {
    if (busy.current) return
    busy.current = true
    setLoggingOut(true)
    try {
      await logout()
    } catch {
      // 서버 연결이 실패해도 AuthProvider 가 토큰·사용자·캐시를 함께 비운다.
      announce(
        '이 기기의 로그인 정보를 지웠어요. 서버 연결이 실패해 새로고침하면 다시 로그인될 수 있어요.',
        { politeness: 'assertive' },
      )
    } finally {
      busy.current = false
      setLoggingOut(false)
    }
  }

  return (
    <Button variant="secondary" size="xl" className="text-3xl!" loading={loggingOut} onClick={() => void signOut()}>
      {loggingOut ? '로그아웃 중' : '로그아웃'}
    </Button>
  )
}
