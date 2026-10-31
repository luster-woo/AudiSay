import { useCallback } from 'react'
import { useAnnouncer } from '@/features/announcer/context'
import { useShortcuts } from './context'

/** 'Alt+Shift+R' (낭독용) */
function speakCombo(combo: string) {
  return combo
    .split('+')
    .map((k) => ({ Alt: '알트', Shift: '시프트', Ctrl: '컨트롤', '/': '슬래시' })[k] ?? k)
    .join(' ')
}

/* 단축키 안내 */
export function useShortcutHelp() {
  const { list } = useShortcuts()
  const { announce } = useAnnouncer()

  return useCallback(() => {
    const items = list.map((d) => `${d.description}, ${speakCombo(d.combo)}`)
    announce(`단축키 ${items.length}개. ${items.join('. ')}.`)
  }, [list, announce])
}