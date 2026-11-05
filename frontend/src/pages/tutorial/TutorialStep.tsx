import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAnnouncer } from '@/features/announcer/context'
import { useAuth } from '@/features/auth/context'
import { useSettings } from '@/features/settings/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { cn } from '@/components/ui/cn'
import { TUTORIAL_STEPS } from './steps'
import { RepeatPractice } from './RepeatPractice'
import { SearchPractice } from './SearchPractice'
import { PlayerPractice } from './PlayerPractice'
import { AskPractice } from './AskPractice'

const PRACTICES = [RepeatPractice, SearchPractice, PlayerPractice, AskPractice]

/** 사용법 n단계 (1~4). 자동으로 넘어가지 않는다 */
export function TutorialStep({ step }: { step: number }) {
  const data = TUTORIAL_STEPS[step - 1]
  const Practice = PRACTICES[step - 1]
  const last = step === TUTORIAL_STEPS.length

  const navigate = useNavigate()
  const { announce } = useAnnouncer()
  const { update } = useSettings()
  const { updateUser } = useAuth()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [done, setDone] = useState(false)
  const markDone = useCallback(() => setDone(true), [])

  usePageEntry({ title: `사용법 ${step}단계`, announce: data.entry, focusRef: headingRef })

  /** 건너뛰거나 마치면 완료로 저장하고 홈으로 (다음 로그인부터 사용법이 나오지 않음) */
  const finish = async () => {
    try {
      await update({ tutorialCompleted: true })
    } catch {
      // 저장 실패는 SettingsProvider 가 이미 알렸다. 사용법은 다음 로그인 때 다시 나온다
    }
    updateUser({ tutorialCompleted: true })
    navigate('/', { replace: true })
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,47.5rem)_18.75rem] lg:justify-center lg:gap-x-20">
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="text-4xl font-bold outline-none">
          {data.title}
        </h1>

        <section
          aria-labelledby="tutorial-guide"
          className="mt-6 rounded-lg bg-navy-deep px-8 py-6"
        >
          <h2 id="tutorial-guide" className="text-lg font-bold text-cream">
            지금 읽는 안내
          </h2>
          {/* 글자는 크게, 줄은 단어 단위로 바꾼다. 상자는 글자 양에 맞춰 늘어난다 */}
          {/* 고대비에서는 상자가 연노랑(navy-deep)이 되어 노란 글자가 안 보이므로 검정 글자 */}
          <p className="mt-3 text-[1.625rem] leading-relaxed font-bold break-keep text-yellow [overflow-wrap:anywhere] hc:text-black">
            {data.guide}
          </p>
        </section>

        <section aria-labelledby="tutorial-practice" className="mt-6 px-4">
          <h2 id="tutorial-practice" className="text-xl font-bold">
            직접 해 보기
          </h2>
          <p className="mt-2 mb-4">{data.practice}</p>
          <Practice done={done} onDone={markDone} />
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          {last ? (
            <Button variant="accent" size="lg" onClick={finish}>
              {data.next}
            </Button>
          ) : (
            <ButtonLink to={`/tutorial/${step + 1}`} variant="accent" size="lg">
              {data.next}
            </ButtonLink>
          )}
          <Button variant="secondary" size="lg" onClick={() => announce(data.guide)}>
            다시 듣기
          </Button>
          {last ? (
            <ButtonLink to="/tutorial/1" size="lg">
              처음부터 다시 듣기
            </ButtonLink>
          ) : (
            <Button variant="secondary" size="lg" onClick={finish}>
              건너뛰고 시작하기
            </Button>
          )}
        </div>
      </div>

      {/* 단계 목록은 왼쪽 안내 상자와 위쪽 줄을 맞춘다 (제목·안내 상자 높이만큼 내린다) */}
      <nav aria-labelledby="tutorial-steps" className="lg:pt-4">
        <h2 id="tutorial-steps" className="text-2xl font-bold">
          {TUTORIAL_STEPS.length}단계 중 {step}단계
        </h2>
        <ol className="mt-4 space-y-2">
          {TUTORIAL_STEPS.map((s, i) => {
            const current = i + 1 === step
            return (
              <li key={s.title}>
                <Link
                  to={`/tutorial/${i + 1}`}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'flex min-h-touch items-center rounded-md border-2 border-navy px-5 font-bold',
                    current ? 'bg-navy text-cream focus-visible:bg-navy' : 'bg-paper text-ink',
                  )}
                >
                  {i + 1} {s.title}
                </Link>
              </li>
            )
          })}
        </ol>
      </nav>
    </div>
  )
}
