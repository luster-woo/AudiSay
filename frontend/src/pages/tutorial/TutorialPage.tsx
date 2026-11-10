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
    title: `튜토리얼 ${step}단계`,
    // 안내 띠에는 단계와 제목만 (설명까지 넣으면 단계마다 띠가 2~3줄로 바뀌며 화면 전체가 밀린다).
    // 설명·사용 방법은 안내창에 있고 '이 단계 설명 다시 듣기'로 읽어 준다
    announce: `튜토리얼 ${total}단계 중 ${step}단계, ${data.screen.name} 화면, ${data.title}.`,
    focusRef: headingRef,
  })

  /** 마치거나 건너뛰면 완료로 저장하고 홈으로 (다음 로그인부터 사용법이 나오지 않음) */
  const done = async () => {
    await finish()
    navigate('/', { replace: true })
  }

  return (
    // 나란히 놓을지는 화면 폭이 아니라 이 영역의 폭으로 정한다(@container): 1100px 이상(예시 화면이 읽을 만한 크기)이고
    // 52rem 이상(글자 크기 설정이 rem 을 바꾸므로, 글자를 키워 자리가 모자라면 위아래로 쌓인다). 예시 화면은 남는 폭을 다 쓰고, 강조 테두리는
    // 그림에 대한 비율이라 어떤 폭에서도 같은 자리를 가리킨다
    <div className="@container xl:-mx-12">
      <div className="grid gap-6 @min-[52rem]:@min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="min-w-0 self-start">
          <TutorialStage screen={data.screen} target={data.target} />
        </div>

        <section
          aria-labelledby="tutorial-title"
          // 나란히 놓이면 예시 화면과 같은 높이로 늘어나고, 글이 더 길면(큰 글자) 안내창이 더 길어진다. 안쪽 스크롤로 버튼을 숨기지 않는다
          className="flex min-w-0 flex-col rounded-2xl border-2 border-line bg-paper p-6 shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
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
            className="mt-3 text-[1.625rem] leading-snug font-bold outline-none"
          >
            {data.title}
          </h1>
          {/* 설명·사용 방법은 단계마다 같은 자리를 잡아 둔다 (설명 4줄, 사용 방법 3줄). 글이 짧아도 아래 점·버튼 위치가 같다 */}
          <p className="mt-4 min-h-[calc(1.625em*4)] text-lg leading-relaxed text-pretty">
            {data.body}
          </p>
          <p className="mt-2 min-h-[calc(1.625em*3)] text-base leading-relaxed text-pretty text-ink-muted">
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
            {/* 한 줄: 왼쪽 다시 듣기, 오른쪽 건너뛰기 */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2">
              {/* 안내 띠의 '스크린리더로 다시 듣기'(마지막 안내)와 구분되는 이름 (버튼 목록으로 훑는 사용자용) */}
              <Button
                variant="ghost"
                onClick={() => announce(spoken)}
                className="px-1! whitespace-nowrap"
              >
                이 단계 설명 다시 듣기
              </Button>
              <Button
                variant="ghost"
                onClick={() => void done()}
                className="px-1! whitespace-nowrap"
              >
                건너뛰기
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
