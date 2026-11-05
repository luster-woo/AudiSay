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
  fullscreen = false,
}: {
  line: NarrationLine | null
  /** 재생을 한 번이라도 시작했는지. 아니면 안내 문구를 보인다 */
  started: boolean
  enlarged?: boolean
  /** 전체 화면 하단 바: 화면 폭에 맞춰 글자를 키운다 (1920px 에서 약 48px) */
  fullscreen?: boolean
}) {
  const waiting = !started || !line
  return (
    <div
      className={cn(
        'flex items-start gap-6 rounded-lg px-5 py-3 hc:border-2 hc:border-yellow',
        waiting ? 'bg-stage/75' : 'bg-stage',
      )}
    >
      <p
        aria-hidden="true"
        className="shrink-0 pt-1 font-mono text-sm leading-tight text-on-stage/70"
      >
        {waiting ? '안내' : '해설'}
        <br />
        {formatClock(line && started ? line.startMs : 0)}
      </p>
      <p
        className={cn(
          // 한국어는 단어 중간에서 끊지 않는다. 띄어쓰기 없는 아주 긴 글자(주소 등)만 어디서든 끊는다
          'leading-snug font-bold break-keep text-yellow [overflow-wrap:anywhere]',
          fullscreen
            ? // 화면 폭·높이 중 작은 쪽에 맞춘 크기. 2줄 자리를 늘 잡아 두어 1~2줄 해설에서는 영상 크기가 출렁이지 않는다
              'min-h-[2.75em] text-[clamp(1.5rem,min(2.5vw,4.5vh),3.5rem)]'
            : enlarged
              ? 'text-[1.75rem]'
              : 'text-[1.625rem]',
        )}
      >
        {line && started ? line.text : '재생을 시작하면 지금 읽는 해설이 여기에 크게 보여요.'}
      </p>
    </div>
  )
}
