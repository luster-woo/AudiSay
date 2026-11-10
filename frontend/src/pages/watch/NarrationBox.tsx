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
  // 해설 시각은 문장과 같은 크기로, 색은 흰색으로 구분한다 (작은 회색 글자는 저시력 사용자가 읽기 어렵다)
  const size = fullscreen
    ? 'text-[clamp(1.5rem,min(2.5vw,4.5vh),3.5rem)]'
    : enlarged
      ? 'text-[1.75rem]'
      : 'text-[1.625rem]'
  return (
    <div
      className={cn(
        'flex items-start gap-6 rounded-lg px-5 py-3 hc:border-2 hc:border-yellow',
        // 전체 화면은 바탕이 검정이라 같은 검정 상자가 묻힌다: 남색 바탕 + 노란 테두리로 띄운다
        // (고대비에서는 남색이 노랑이 되므로 검정 바탕 그대로)
        fullscreen
          ? 'border-2 border-yellow bg-navy hc:bg-stage'
          : waiting
            ? 'bg-stage/75'
            : 'bg-stage',
      )}
    >
      {/* '해설 0:18'을 한 줄로. 숫자 폭을 고정해 시각이 바뀌어도 문장 위치가 흔들리지 않는다 */}
      <p
        aria-hidden="true"
        className={cn(
          'shrink-0 leading-snug font-bold whitespace-nowrap text-white tabular-nums',
          size,
        )}
      >
        {waiting ? '안내' : '해설'} {formatClock(line && started ? line.startMs : 0)}
      </p>
      <p
        className={cn(
          // 한국어는 단어 중간에서 끊지 않는다. 띄어쓰기 없는 아주 긴 글자(주소 등)만 어디서든 끊는다
          'leading-snug font-bold text-yellow [overflow-wrap:anywhere]',
          size,
          // 3줄 자리를 늘 잡아 두어 문장 길이에 따라 상자가 커졌다 작아졌다 하지 않는다 (줄 높이 1.375 × 3).
          // 3줄을 넘는 긴 문장은 자르지 않고 늘어난다. 전체 화면은 영상 크기가 출렁이지 않게 2줄 자리만
          fullscreen ? 'min-h-[2.75em]' : 'min-h-[4.125em]',
        )}
      >
        {line && started ? line.text : '재생을 시작하면 지금 읽는 해설이 여기에 크게 보여요.'}
      </p>
    </div>
  )
}
