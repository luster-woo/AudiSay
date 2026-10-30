import { useRef } from 'react'
import { useAuth } from '@/features/auth/context'
import { useSettings } from '@/features/settings/context'
import { useAnnouncer } from '@/features/announcer/context'
import { useShortcut } from '@/features/shortcuts/context'
import { usePageEntry } from '@/features/page/usePageEntry'

export default function App() {
  const { status, user } = useAuth()
  const { settings, update } = useSettings()
  const { lastMessage, repeat } = useAnnouncer()
  const inputRef = useRef<HTMLInputElement>(null)

  usePageEntry({
    title: '테스트',
    announce: '테스트 화면이에요. 검색 칸에 있어요.',
    focusRef: inputRef,
    ready: status !== 'loading',
  })
  useShortcut('Alt+Shift+R', repeat, { description: '방금 안내 다시 듣기' })

  if (status === 'loading') return null

  return (
    <main id="main" tabIndex={-1} className="p-8 space-y-4">
      <p className="bg-navy text-yellow px-4 py-2">방금 안내: {lastMessage}</p>
      <p>
        상태: {status} / {user?.name ?? '비로그인'} / {user?.role ?? '-'}
      </p>
      <input
        ref={inputRef}
        className="rounded-md border border-line bg-paper px-4"
        placeholder="검색어"
      />
      <button
        className="rounded-md bg-navy px-6 text-cream"
        onClick={() =>
          update({
            fontSizeLevel:
              settings.fontSizeLevel === 5
                ? 1
                : ((settings.fontSizeLevel + 1) as 1 | 2 | 3 | 4 | 5),
          })
        }
      >
        글자 크기 {settings.fontSizeLevel}
      </button>
      <button
        className="rounded-md bg-navy px-6 text-cream"
        onClick={() => update({ highContrast: !settings.highContrast })}
      >
        고대비 {settings.highContrast ? '켜짐' : '꺼짐'}
      </button>
    </main>
  )
}
