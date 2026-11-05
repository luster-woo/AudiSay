import { useAnnouncer } from '@/features/announcer/context'
import { useShortcutEntry } from './context'
import { useShortcutHelp } from './useShortcutHelp'
import { ShortcutHelpDialog } from './ShortcutHelpDialog'

/** 어느 화면에서든 동작하는 단축키 + 단축키 안내 창. RootProviders 에서 한 번만 렌더한다 */
export function GlobalShortcuts() {
  const { repeat } = useAnnouncer()
  const openHelp = useShortcutHelp()

  // 다시 듣기는 대화상자 안에서도 쓴다 (창 안내를 놓쳤을 때)
  useShortcutEntry('repeat', () => repeat(), { allowInDialog: true })
  useShortcutEntry('help', () => openHelp())

  return <ShortcutHelpDialog />
}
