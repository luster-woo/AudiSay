import type { NarrationLine } from '@/api/types'
import { cn } from '@/components/ui/cn'
import { formatClock } from '@/utils/time'

/**
 * 지금 읽는 해설 문장을 크게 보여 주는 상자. 저시력 사용자가 눈으로 따라가는 용도다.
 * 서버 음성이 이미 읽으므로 live 영역으로 만들지 않는다 (원칙 1장). 낭독기로 찾아가 읽을 수는 있다.
 */
export function NarrationBox({
  line,
  started,
  enlarged,
}: {
  line: NarrationLine | null
  /** 재생을 한 번이라도 시작했는지. 아니면 안내 문구를 보인다 */
  started: boolean
  enlarged?: boolean
}) {
  const waiting = !started || !line
  return (
    <div
      className={cn(
        'flex items-start gap-6 rounded-lg px-5 py-3',
        waiting ? 'bg-ink-muted/70' : 'bg-ink',
      )}
    >
      <p aria-hidden="true" className="shrink-0 pt-1 font-mono text-sm leading-tight text-cream/70">
        {waiting ? '안내' : '해설'}
        <br />
        {formatClock(line && started ? line.startMs : 0)}
      </p>
      <p
        className={cn(
          'leading-snug font-bold text-yellow',
          enlarged ? 'text-[1.75rem]' : 'text-[1.625rem]',
        )}
      >
        {line && started ? line.text : '재생을 시작하면 지금 읽는 해설이 여기에 크게 보여요.'}
      </p>
    </div>
  )
}
