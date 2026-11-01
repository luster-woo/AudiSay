import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { usePageEntry } from '@/features/page/usePageEntry'
import { useShortcutHelp } from '@/features/shortcuts/useShortcutHelp'
import { LogoMark } from '@/layouts/parts/LogoMark'

/** 소리 막대 장식 높이(%) — 와이어프레임의 파형. 낭독기에는 숨긴다 */
const BARS = [45, 78, 33, 100, 57, 21, 72, 39, 88, 47, 15, 64]

/** 로그인 전 첫 화면. BareLayout 안이라 헤더·안내 띠가 없다 */
export default function LandingPage() {
  const startRef = useRef<HTMLAnchorElement>(null)
  const openHelp = useShortcutHelp()

  usePageEntry({
    title: '시작하기',
    announce: 'AudiSay예요. 지금 시작하기 링크에 있어요. 단축키 안내는 Alt+Shift+슬래시.',
    focusRef: startRef,
  })

  // 남색 배경 위 포커스는 노란 외곽선 (전역 남색 링이 안 보임)
  const onNavyFocus = 'focus-visible:bg-transparent focus-visible:outline-yellow'

  return (
    <div className="flex min-h-svh flex-col bg-navy px-16 pt-12 pb-5 text-cream">
      <p className="flex items-center gap-2 text-2xl font-bold">
        <LogoMark />
        AudiSay
      </p>

      <div className="flex flex-1 items-end justify-between gap-12 pb-14">
        <div className="max-w-2xl">
          <p className="font-bold text-yellow">시각장애인을 위한 유튜브 화면해설</p>
          <h1 className="mt-4 text-[5.5rem] leading-[1.1] font-bold">
            보이지 않아도,
            <br />
            들리니까.
          </h1>
          <p className="mt-9 text-xl leading-normal text-cream/90">
            대사가 멈춘 순간, 화면에 무엇이 있는지
            <br />
            AI가 음성으로 바로 알려줘요.
          </p>
          <Link
            ref={startRef}
            to="/login"
            className="mt-14 inline-flex min-h-18 min-w-[18.75rem] items-center justify-center rounded-md bg-yellow px-10 text-xl font-bold text-navy focus-visible:bg-yellow focus-visible:outline-dashed focus-visible:outline-cream"
          >
            지금 시작하기
          </Link>
        </div>

        <div aria-hidden="true" className="hidden h-[41.25rem] items-center gap-9 lg:flex">
          {BARS.map((h, i) => (
            <span
              key={i}
              className={i === 3 ? 'w-5 rounded-full bg-yellow' : 'w-5 rounded-full bg-cream/10'}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-cream/20 pt-2 text-sm text-cream/80">
        <p>키보드만으로 전부 조작 · 화면 낭독기와 소리 겹침 없음 · 고대비 · 200% 확대</p>
        <button
          type="button"
          onClick={openHelp}
          aria-keyshortcuts="Alt+Shift+/"
          className={`relative min-h-10 rounded-sm px-2 before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] ${onNavyFocus}`}
        >
          단축키 안내 Alt+Shift+/
        </button>
      </footer>
    </div>
  )
}
