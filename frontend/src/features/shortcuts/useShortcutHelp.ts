import { useCallback } from 'react'
import { useShortcuts } from './context'

/** 단축키 안내 창을 연다 (Alt+Shift+/, 안내 띠의 '단축키' 버튼) */
export function useShortcutHelp() {
  const { setHelpOpen } = useShortcuts()
  return useCallback(() => setHelpOpen(true), [setHelpOpen])
}