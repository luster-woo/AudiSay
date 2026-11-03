import { createContext, useContext } from 'react'

/**
 * 관리자 위쪽 줄(브레드크럼 옆) 가운데 자리.
 * 페이지가 createPortal 로 이 요소에 상태 선택 같은 조작을 넣는다 (와이어프레임: 처리 전/완료/반려).
 */
export const AdminTopbarContext = createContext<HTMLElement | null>(null)

export function useAdminTopbar() {
  return useContext(AdminTopbarContext)
}
