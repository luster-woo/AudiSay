import { useEffect, type RefObject } from 'react'
import { useAnnouncer } from '@/features/announcer/context'

interface PageEntryOptions {
  /** 브라우저 탭 제목 */
  title: string
  /** 진입 시 읽어 줄 문구 */
  announce: string
  /** 초기 포커스를 둘 요소. 없으면 <main> 으로 */
  focusRef?: RefObject<HTMLElement | null>

  ready?: boolean
}

export function usePageEntry({ title, announce: text, focusRef, ready = true }: PageEntryOptions) {
  const { announce } = useAnnouncer()

  useEffect(() => {
    if (!ready) return
    document.title = `${title} – AudiSay`
    // 포커스를 먼저 옮기고 → 낭독기가 포커스 요소를 읽은 뒤 → 안내 문구가 이어지도록 한 프레임 뒤에 announce
    const target = focusRef?.current ?? document.getElementById('main')
    // 화면에 들어오자마자 대화상자가 열렸으면(예: 업로드 끊김) 포커스를 창 밖으로 빼지 않는다
    if (!document.querySelector('dialog[open]')) target?.focus({ preventScroll: true })
    const id = requestAnimationFrame(() => announce(text))
    return () => cancelAnimationFrame(id)
  }, [ready, title, text, focusRef, announce])
}
