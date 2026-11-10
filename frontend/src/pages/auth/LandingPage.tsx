import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import mascot from '@/assets/landing-mascot.webp'
import { usePageEntry } from '@/features/page/usePageEntry'
import { useShortcutHelp } from '@/features/shortcuts/useShortcutHelp'
import { LogoMark } from '@/layouts/parts/LogoMark'

/** 남색 배경 위 포커스는 노란 외곽선 (전역 남색 링이 안 보임) */
const ON_NAVY_FOCUS = 'focus-visible:bg-transparent focus-visible:outline-yellow'

/** 단축키 글자 상자. 고대비(노란 바탕)에서는 검정 글자·테두리 */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-h-11 min-w-12 items-center justify-center rounded-md border-2 border-yellow px-3 font-mono text-lg text-yellow hc:border-cream hc:text-cream">
      {children}
    </kbd>
  )
}

/** 아래 기능 소개 4개. 아이콘은 장식이라 낭독기에 숨기고 글자만 읽는다 */
const FEATURES: { label: string; icon: ReactNode }[] = [
  {
    label: '키보드로 모든 기능 조작',
    icon: (
      <svg viewBox="0 0 64 40" className="h-12 w-auto" fill="none">
        <rect x="2" y="2" width="60" height="36" rx="7" stroke="currentColor" strokeWidth="3.5" />
        <path
          d="M13 14h2M23 14h2M33 14h2M43 14h2M51 14h0M16 26h32"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: '낭독기와 소리 겹침 방지',
    // 그림 오른쪽에 빈칸이 있어 글자 가운데보다 왼쪽으로 보였다. 보이는 부분에 맞춰 viewBox 를 줄여 가운데로
    icon: (
      <svg viewBox="1 1 54 46" className="h-12 w-auto" fill="none">
        <path
          d="M4 17h9l14-12v38L13 31H4z"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        <path
          d="M38 17c3 4 3 10 0 14M47 10c7 8 7 20 0 28"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: '고대비로 선명한 화면',
    icon: (
      <svg viewBox="0 0 48 48" className="h-12 w-auto">
        <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3.5" />
        <path d="M24 3a21 21 0 0 1 0 42z" fill="currentColor" />
      </svg>
    ),
  },
  {
    label: '글자 크기 5단계 조절',
    icon: (
      <span className="flex h-12 items-end font-bold">
        <span className="text-2xl leading-none">가</span>
        <span className="text-5xl leading-none">가</span>
      </span>
    ),
  },
]

/** 로그인 전 첫 화면. BareLayout 안이라 헤더·안내 띠가 없다 */
export default function LandingPage() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const openHelp = useShortcutHelp()

  // 바탕을 남색으로 칠하는 표시 (index.html 이 새로고침 때 먼저 붙인다). 다른 화면으로 가면 지운다
  useEffect(() => {
    const root = document.documentElement
    root.dataset.page = 'landing'
    return () => {
      delete root.dataset.page
    }
  }, [])

  // 로그아웃·탈퇴 뒤에 왔으면 그 안내("로그아웃했어요.")를 입장 안내 앞에 붙인다
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  usePageEntry({
    title: '시작하기',
    // 처음 온 사람이 무슨 서비스인지 듣도록 포커스는 제목(h1)에. 다음 Tab 이 '지금 시작하기'
    announce: `${notice ? `${notice} ` : ''}AudiSay예요. Tab을 누르면 '지금 시작하기', 로그인 화면으로 가요.`,
    focusRef: headingRef,
  })

  return (
    // 시안 바탕(#172a46). 고대비에서는 다른 화면처럼 노란 바탕 + 검정 글자
    <div className="flex min-h-svh flex-col bg-[#172a46] text-cream hc:bg-navy">
      <div className="mx-auto flex w-full max-w-[81.25rem] flex-1 flex-col px-8 pt-12 pb-14">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <p className="flex items-center gap-3 text-[2.5rem] font-bold">
            <LogoMark />
            AudiSay
          </p>
          <button
            type="button"
            onClick={openHelp}
            aria-keyshortcuts="Alt+Shift+/"
            className={`flex min-h-12 items-center gap-3 rounded-md px-2 text-xl font-bold text-yellow hc:text-cream ${ON_NAVY_FOCUS}`}
          >
            단축키 안내
            {/* 키는 aria-keyshortcuts 로 읽히므로 눈에 보이는 키 글자는 이름에서 뺀다 (같은 키를 두 번 읽지 않게) */}
            <span aria-hidden="true" className="flex items-center gap-2">
              <Key>Alt</Key>
              <span aria-hidden="true">+</span>
              <Key>Shift</Key>
              <span aria-hidden="true">+</span>
              <Key>/</Key>
            </span>
          </button>
        </div>

        <div className="flex flex-1 items-center justify-between gap-12 py-16">
          <div>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-[4.5rem] leading-[1.25] font-bold outline-none"
            >
              시각장애인을 위한
              <br />
              영상 화면해설
            </h1>
            <p className="mt-6 text-[1.75rem] text-cream/90">
              보이지 않는 장면까지 목소리로 들려드려요.
            </p>
            <Link
              to="/login"
              className="mt-12 inline-flex min-h-[4.25rem] min-w-[17.5rem] items-center justify-center rounded-md bg-yellow px-10 text-2xl font-bold text-navy focus-visible:bg-yellow focus-visible:outline-dashed focus-visible:outline-cream hc:bg-black! hc:text-[#ffd600]!"
            >
              지금 시작하기
            </Link>
          </div>
          {/* 마스코트(손 흔드는 강아지)는 장식이라 낭독기에 숨긴다 */}
          <img
            src={mascot}
            alt=""
            aria-hidden="true"
            width={584}
            height={728}
            className="hidden h-auto w-[21rem] shrink-0 lg:block"
          />
        </div>

        <ul className="grid grid-cols-2 gap-x-6 gap-y-10 border-t border-cream/20 pt-12 text-center lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li key={f.label} className="flex flex-col items-center gap-6">
              <span aria-hidden="true" className="text-cream/90">
                {f.icon}
              </span>
              <span className="text-2xl font-bold">{f.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
