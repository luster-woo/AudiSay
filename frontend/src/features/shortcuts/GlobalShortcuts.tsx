import { useAnnouncer } from '@/features/announcer/context'
import { useShortcut } from './context'
import { useShortcutHelp } from './useShortcutHelp'

/** 어느 화면에서든 동작하는 단축키. RootProviders 에서 한 번만 렌더링 */
export function GlobalShortcuts() {
  const { repeat } = useAnnouncer()
  const openHelp = useShortcutHelp()

  useShortcut('Alt+Shift+R', repeat, { description: '방금 안내 다시 듣기' })
  useShortcut('Alt+Shift+/', openHelp, { description: '단축키 안내' })

  return null
}