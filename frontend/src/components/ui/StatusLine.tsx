import { cn } from './cn'

/** "○ 아직 누르지 않았어요" → "● 해 봤어요". 기호는 숨기고 문장만 읽힌다 (원칙 11장) */
export function StatusLine({
  done,
  text,
  className,
}: {
  done: boolean
  text: string
  className?: string
}) {
  return (
    <p
      className={cn(
        'flex items-center gap-2',
        done ? 'font-bold text-success' : 'text-ink',
        className,
      )}
    >
      <span aria-hidden="true">{done ? '●' : '○'}</span>
      {text}
    </p>
  )
}
