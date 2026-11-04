import { cn } from '@/components/ui/cn'
import type { Step, StepState } from './stages'

const STATE_TEXT: Record<StepState, string> = {
  pending: '대기',
  active: '진행 중',
  done: '완료',
  failed: '멈춤',
}

function StepIcon({ state }: { state: StepState }) {
  // 색만으로 구분하지 않도록 상태마다 모양이 다르다 (원칙 10장): 완료 ✓, 진행 중 ●, 멈춤 ×, 대기 빈 원
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full border-4',
        state === 'done' && 'border-navy bg-navy text-paper',
        state === 'active' && 'border-navy bg-paper',
        state === 'failed' && 'border-danger bg-danger text-paper',
        state === 'pending' && 'border-line bg-paper',
      )}
    >
      {state === 'done' && (
        <svg
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={3.5}
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === 'active' && <span className="size-4 rounded-full bg-navy" />}
      {state === 'failed' && (
        <svg
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={3.5}
        >
          <path d="M7 7l10 10M17 7L7 17" strokeLinecap="round" />
        </svg>
      )}
    </span>
  )
}

/**
 * 해설 만들기 단계 목록. 유튜브는 4단계, 업로드 영상은 '영상 업로드'를 더한 5단계.
 * 각 항목은 "영상 분석, 진행 중"처럼 이름과 상태를 함께 읽는다. 바뀔 때 읽어 주기는 화면이 맡는다.
 */
export function JobSteps({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol aria-label="진행 단계" className={cn('flex flex-col', className)}>
      {steps.map((step, i) => (
        <li
          key={step.key}
          aria-current={step.state === 'active' ? 'step' : undefined}
          className="relative flex min-h-[4.5rem] items-start gap-5"
        >
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-12 bottom-0 left-[1.375rem] w-1',
                step.state === 'done' ? 'bg-navy' : 'bg-line',
              )}
            />
          )}
          <StepIcon state={step.state} />
          <p className="flex flex-wrap items-baseline gap-x-3 pt-2 text-2xl">
            <span className={cn(step.state === 'active' && 'font-bold')}>{step.label}</span>
            <span
              className={cn(
                'text-xl',
                step.state === 'failed' ? 'font-bold text-danger' : 'text-ink-muted',
              )}
            >
              <span className="sr-only">, </span>
              {STATE_TEXT[step.state]}
            </span>
          </p>
        </li>
      ))}
    </ol>
  )
}
