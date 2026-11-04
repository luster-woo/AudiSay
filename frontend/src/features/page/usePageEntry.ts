import { useEffect, type RefObject } from 'react'
import { useAnnouncer } from '@/features/announcer/context'

/** 브라우저 탭 제목. 모든 화면에서 같은 이름을 쓴다 (2026-11-04 결정) */
export const APP_TITLE = 'AudiSay'

interface PageEntryOptions {
  /** 화면 이름. 탭 제목은 APP_TITLE 로 통일해서 지금은 쓰지 않는다(화면 이름을 다시 붙일 때 쓰려고 남겨 둠) */
  title: string
  /** 진입 시 읽어 줄 문구 */
  announce: string
  /** 초기 포커스를 둘 요소. 없으면 <main> 으로 */
  focusRef?: RefObject<HTMLElement | null>

  ready?: boolean
}

export function usePageEntry({ announce: text, focusRef, ready = true }: PageEntryOptions) {
  const { announce } = useAnnouncer()

  useEffect(() => {
    if (!ready) return
    document.title = APP_TITLE
    // 포커스를 먼저 옮기고 → 낭독기가 포커스 요소를 읽은 뒤 → 안내 문구가 이어지도록 한 프레임 뒤에 announce
    const target = focusRef?.current ?? document.getElementById('main')
    // 화면에 들어오자마자 대화상자가 열렸으면(예: 업로드 끊김) 포커스를 창 밖으로 빼지 않는다
    if (!document.querySelector('dialog[open]')) target?.focus({ preventScroll: true })
    const id = requestAnimationFrame(() => announce(text))
    return () => cancelAnimationFrame(id)
  }, [ready, text, focusRef, announce])
}
