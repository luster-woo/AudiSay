import { Outlet } from 'react-router-dom'

/** 랜딩·404 처럼 헤더 없이 화면 전체를 쓰는 페이지. <main> 만 제공한다 */
export function BareLayout() {
  return (
    <main id="main" tabIndex={-1} className="min-h-svh outline-none">
      <Outlet />
    </main>
  )
}