import { useRef } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { cn } from '@/components/ui/cn'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { useFinishTutorial } from '@/features/tour/useFinishTutorial'
import { TUTORIAL_STEPS } from './steps'
import { TutorialStage } from './TutorialStage'

/** /tutorial/:step — 잘못된 단계 번호는 1단계로 보낸다 */
export default function TutorialPage() {
  const step = Number(useParams().step)
  if (!Number.isInteger(step) || step < 1 || step > TUTORIAL_STEPS.length) {
    return <Navigate to="/tutorial/1" replace />
  }
  return <TutorialView step={step} />
}

/**
 * 사용법 n단계. 실제 화면 캡처(예시 화면)에서 기능 하나를 노란 테두리로 강조하고(왼쪽),
 * 그 기능의 설명을 안내창에 보여 준다(오른쪽, 예시 화면과 같은 높이로 맞추고 버튼은 아래에 붙인다. 좁은 화면은 아래).
 * 진짜 화면이 아니라서 요약 묻는 창 같은 다른 창이 끼어들지 않고, 스크롤해도 강조가 어긋나지 않는다.
 * 단계는 주소로 나뉘어 뒤로 가기로도 오갈 수 있다. 자동으로 넘어가지 않는다.
 */
function TutorialView({ step }: { step: number }) {
  const data = TUTORIAL_STEPS[step - 1]
  const total = TUTORIAL_STEPS.length
  const last = step === total
  const navigate = useNavigate()
  const { announce } = useAnnouncer()
  const finish = useFinishTutorial()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const spoken = `${data.body} ${data.keys}`

  usePageEntry({
    title: `사용법 ${step}단계`,
    announce: `사용법 ${total}단계 중 ${step}단계, ${data.screen.name} 화면. ${spoken}`,
    focusRef: headingRef,
  })

  /** 마치거나 건너뛰면 완료로 저장하고 홈으로 (다음 로그인부터 사용법이 나오지 않음) */
  const done = async () => {
    await finish()
    navigate('/', { replace: true })
  }

  return (
    <div className="grid gap-6 xl:-mx-12 xl:grid-cols-[minmax(0,56rem)_21rem] xl:justify-center">
      <div className="min-w-0">
        <TutorialStage screen={data.screen} target={data.target} />
      </div>

      <section
        aria-labelledby="tutorial-title"
        className="flex flex-col rounded-2xl border-2 border-line bg-paper p-6 shadow-[0_12px_32px_rgba(0,0,0,0.12)] xl:h-0 xl:min-h-full xl:overflow-y-auto"
      >
        {/* 머리: 마스코트 상자·단계 표시·제목 자리를 모든 단계에서 같은 크기로 (제목은 한 줄) */}
        <div className="flex items-center gap-4">
          <img
            src={data.mascot}
            alt=""
            aria-hidden="true"
            width={320}
            height={400}
            className="h-24 w-[4.8rem] shrink-0"
          />
          <p className="text-lg font-bold text-ink-muted">
            <span aria-hidden="true">
              {step} / {total} · {data.screen.name}
            </span>
            <span className="sr-only">
              {total}단계 중 {step}단계, {data.screen.name} 화면
            </span>
          </p>
        </div>
        <h1
          ref={headingRef}
          id="tutorial-title"
          tabIndex={-1}
          className="mt-3 text-[1.625rem] leading-snug font-bold break-keep outline-none"
        >
          {data.title}
        </h1>
        <p className="mt-4 text-xl leading-relaxed text-pretty break-keep">{data.body}</p>
        <p className="mt-2 text-lg leading-relaxed text-pretty break-keep text-ink-muted">
          <span className="sr-only">사용 방법: </span>
          {data.keys}
        </p>

        {/* 진행 점: 안내창 폭에 고르게 펼친 원, 지난 단계와 지금 단계는 색칠 (숫자로 이미 읽으므로 낭독기에는 숨긴다) */}
        <div className="mt-auto pt-5">
          <ol aria-hidden="true" className="flex items-center justify-between">
            {TUTORIAL_STEPS.map((s, i) => (
              <li
                key={s.title}
                className={cn('size-3 rounded-full', i < step ? 'bg-navy' : 'bg-line')}
              />
            ))}
          </ol>

          <div className="mt-5 grid grid-cols-2 gap-3">
            {step > 1 ? (
              <ButtonLink
                to={`/tutorial/${step - 1}`}
                replace
                variant="secondary"
                size="lg"
                className="w-full px-4!"
              >
                이전
              </ButtonLink>
            ) : (
              <Button variant="secondary" size="lg" disabled className="w-full px-4!">
                이전
              </Button>
            )}
            {last ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() => void done()}
                className="w-full px-4!"
              >
                다음
              </Button>
            ) : (
              <ButtonLink
                to={`/tutorial/${step + 1}`}
                replace
                variant="primary"
                size="lg"
                className="w-full px-4!"
              >
                다음
              </ButtonLink>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => announce(spoken)} className="px-2">
              다시 듣기
            </Button>
            <Button variant="ghost" onClick={() => void done()} className="px-2">
              건너뛰기
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
