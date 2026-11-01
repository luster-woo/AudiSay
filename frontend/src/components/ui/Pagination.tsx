import type { PageInfo } from '@/api/types'
import { Button } from './Button'
import { cn } from './cn'

export interface PaginationProps {
  page: PageInfo
  onChange: (pageNumber: number) => void
  unit?: string
  /** xl: 홈·검색 결과의 큰 버튼 (Figma) */
  size?: 'md' | 'xl'
  className?: string
}

/**
 * 이전/다음 페이지 (홈 영상 목록, 관리자 회원 목록).
 * 끝 페이지에서도 버튼을 숨기지 않고 aria-disabled 로 둔다.
 * 페이지를 바꾼 뒤 목록 제목으로 포커스를 옮기는 건 페이지 쪽이 맡는다.
 * aria-label 은 보이는 글자('이전')를 포함해야 한다 — 음성 명령 사용자가 "이전 클릭"으로 누를 수 있게.
 */
export function Pagination({
  page,
  onChange,
  unit = '개',
  size = 'md',
  className,
}: PaginationProps) {
  const big = size === 'xl'
  const start = page.totalElements === 0 ? 0 : page.number * page.size + 1
  const end = Math.min((page.number + 1) * page.size, page.totalElements)

  return (
    <nav aria-label="페이지" className={cn('flex items-center justify-between gap-4', className)}>
      <p className={big ? 'text-2xl text-ink' : 'text-lg text-ink-muted'}>
        <span aria-hidden="true">
          {start}–{end} / {page.totalElements}
          {unit}
        </span>
        <span className="sr-only">
          전체 {page.totalElements}
          {unit} 중 {start}번째부터 {end}번째까지
        </span>
      </p>
      <div className="flex gap-3">
        <Button
          variant="secondary"
          size={big ? 'xl' : 'md'}
          className={big ? 'min-w-[13.5rem]' : undefined}
          aria-label="이전 페이지"
          disabled={page.first}
          onClick={() => onChange(page.number - 1)}
        >
          이전
        </Button>
        <Button
          variant="secondary"
          size={big ? 'xl' : 'md'}
          className={big ? 'min-w-[13.5rem]' : undefined}
          aria-label="다음 페이지"
          disabled={page.last}
          onClick={() => onChange(page.number + 1)}
        >
          다음
        </Button>
      </div>
    </nav>
  )
}
