import { useAnnouncer } from '@/features/announcer/context'
import { useShortcutHelp } from '@/features/shortcuts/useShortcutHelp'

/**
 * 와이어프레임의 남색 '방금 안내' 띠
 * 저시력 사용자가 눈으로 보는 용도
 * 그래서 이 영역 자체에는 aria-live 를 두지 않음.
 */
export function AnnounceBar() {
  const { lastMessage, repeat } = useAnnouncer()
  const openHelp = useShortcutHelp()
  const barButton =
    'relative flex min-h-10 items-center gap-2 rounded-md px-2 text-sm text-cream before:absolute before:inset-x-0 before:-inset-y-2 before:content-[""] focus-visible:bg-navy-deep focus-visible:outline-yellow'

  return (
    <section aria-label="방금 안내" className="bg-navy">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-6 gap-y-1 px-16 py-1">
        <span className="text-sm text-cream/80">방금 안내</span>
        <p className="min-w-0 flex-1 font-bold text-yellow">{lastMessage}</p>
        <button type="button" className={barButton} onClick={repeat} aria-keyshortcuts="Alt+Shift+R">
          다시 듣기 <kbd className="kbd text-yellow">Alt+Shift+R</kbd>
        </button>
        <button type="button" className={barButton} onClick={openHelp} aria-keyshortcuts="Alt+Shift+/">
          단축키 <kbd className="kbd text-yellow">Alt+Shift+/</kbd>
        </button>
      </div>
    </section>
  )
}
