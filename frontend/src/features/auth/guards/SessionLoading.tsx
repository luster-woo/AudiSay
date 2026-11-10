import { useEffect, useState } from 'react'

/** 이보다 빨리 끝나면(대부분, 로그아웃 이동 포함) 아무것도 보이거나 읽히지 않게 */
const SHOW_AFTER_MS = 500

/**
 * 앱을 열고 세션(로그인)을 복원하는 동안 보이는 화면.
 * 빈 화면이면 낭독기 사용자는 고장인지 기다리는 중인지 알 수 없어, 잠깐 넘게 걸리면 제목과 문구를 보인다
 * (복원은 15초 시간 제한 안에 끝난다)
 */
export function SessionLoading() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => {
      document.title = '불러오는 중 - AudiSay'
      setShown(true)
    }, SHOW_AFTER_MS)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream p-10">
      <p role="status" className="text-2xl font-bold">
        {shown ? '불러오는 중이에요.' : ''}
      </p>
    </main>
  )
}
