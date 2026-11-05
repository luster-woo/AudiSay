import { Button } from './Button'
import { cn } from './cn'

/** 한 번에 보이는 쪽 번호 개수 */
const BLOCK = 5

export interface PageNumbersProps {
  /** 지금 쪽 (0부터) */
  page: number
  /** 전체 쪽 수 */
  totalPages: number
  onChange: (page: number) => void
  /** sm: 관리자 표 아래 · xl: 홈 영상 목록 (큰 버튼) */
  size?: 'sm' | 'xl'
  className?: string
}

/**
 * 목록 아래 가운데 '이전 1 2 3 4 5 다음'.
 * 번호는 5개씩 묶어서 보인다: 1~5쪽 → 1 2 3 4 5, 6쪽으로 넘어가면 6 (6~10 묶음, 있는 쪽까지만).
 * 번호 버튼 이름은 "N쪽", 지금 쪽은 aria-current="page".
 * 끝 쪽에서도 이전/다음은 숨기지 않고 aria-disabled 로 둔다.
 */
export function PageNumbers({
  page,
  totalPages,
  onChange,
  size = 'sm',
  className,
}: PageNumbersProps) {
  const big = size === 'xl'
  const pages = Math.max(1, totalPages)
  const start = Math.floor(page / BLOCK) * BLOCK
  const numbers = Array.from({ length: Math.min(BLOCK, pages - start) }, (_, i) => start + i)

  return (
    <nav
      aria-label="페이지"
      className={cn(
        'flex items-center justify-center',
        big ? 'gap-4' : 'gap-[0.6667rem]',
        className,
      )}
    >
      <Button
        variant="secondary"
        size={big ? 'xl' : 'sm'}
        className={big ? 'min-w-[9rem]' : undefined}
        aria-label="이전 페이지"
        disabled={page <= 0}
        onClick={() => onChange(page - 1)}
      >
        이전
      </Button>
      <ul className={cn('flex items-center', big ? 'gap-2' : 'gap-[0.2667rem]')}>
        {numbers.map((n) => {
          const current = n === page
          return (
            <li key={n}>
              <button
                type="button"
                aria-label={`${n + 1}쪽`}
                aria-current={current ? 'page' : undefined}
                onClick={() => !current && onChange(n)}
                className={cn(
                  'flex items-center justify-center rounded-sm',
                  big ? 'size-touch text-2xl' : 'size-[2.2667rem] min-h-0 text-[0.9333rem]',
                  current ? 'bg-navy font-bold text-paper' : 'text-ink hover:bg-cream',
                )}
              >
                {n + 1}
              </button>
            </li>
          )
        })}
      </ul>
      <Button
        variant="secondary"
        size={big ? 'xl' : 'sm'}
        className={big ? 'min-w-[9rem]' : undefined}
        aria-label="다음 페이지"
        disabled={page >= pages - 1}
        onClick={() => onChange(page + 1)}
      >
        다음
      </Button>
    </nav>
  )
}
