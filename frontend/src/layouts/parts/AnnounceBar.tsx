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
    'relative flex min-h-10 items-center gap-2 rounded-md px-2 text-sm text-cream before:absolute before:inset-x-0 before:-inset-y-2 before:content-[""] focus-visible:bg-navy-deep focus-visible:outline-yellow hc:text-ink hc:focus-visible:bg-yellow-soft'

  return (
    // 고대비: 남색 띠 대신 검정 띠 + 노란 선(navy 가 노랑이 되므로 따로 정한다)
    <section aria-label="방금 안내" className="bg-navy hc:border-b-2 hc:border-yellow hc:bg-paper">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-1 sm:px-8 lg:px-16">
        <span className="text-sm text-cream/80 hc:text-ink-muted">방금 안내</span>
        {/* 늘 두 줄 높이를 잡아 둔다. 안내 문구 길이가 바뀔 때마다 띠 높이가 바뀌면 아래 화면 전체가 위아래로 움직인다 */}
        <p className="flex min-h-[3em] min-w-[min(16rem,100%)] flex-1 items-center font-bold text-yellow">
          {lastMessage}
        </p>
        {/* 읽는 주체는 사용자의 스크린리더다 (AudiSay 가 소리를 내지 않는다). 스크린리더 없이 누르면 아무 소리도
            나지 않아 '다시 듣기'만으로는 고장으로 오해할 수 있어 이름에 밝힌다 */}
        <button
          type="button"
          className={barButton}
          onClick={repeat}
          aria-keyshortcuts="Alt+Shift+R"
        >
          {/* 키는 aria-keyshortcuts 로 읽히므로 눈에 보이는 글자는 이름에서 뺀다 (같은 키를 두 번 읽지 않게) */}
          스크린리더로 다시 듣기{' '}
          <kbd aria-hidden="true" className="kbd text-yellow">
            Alt+Shift+R
          </kbd>
        </button>
        <button
          type="button"
          className={barButton}
          onClick={openHelp}
          aria-keyshortcuts="Alt+Shift+/"
        >
          단축키{' '}
          <kbd aria-hidden="true" className="kbd text-yellow">
            Alt+Shift+/
          </kbd>
        </button>
      </div>
    </section>
  )
}
