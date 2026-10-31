import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react'
import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost'
type Size = 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary 남색 · secondary 흰 바탕 · accent 노랑(다음·신청) · danger 빨강(반려·다시 만들기) · ghost 밑줄 링크형 */
  variant?: Variant
  size?: Size
  /** 처리 중. 누를 수 없고 낭독기에 '사용 중'으로 알린다 */
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
}

const VARIANT: Record<Variant, string> = {
  // 남색 버튼은 전역 포커스 배경(연노랑)이 글자를 가리므로 배경을 유지한다
  primary: 'border-navy bg-navy text-cream focus-visible:bg-navy-deep',
  secondary: 'border-navy bg-paper text-navy',
  accent: 'border-yellow bg-yellow text-navy focus-visible:bg-yellow',
  danger: 'border-danger bg-paper text-danger',
  ghost: 'border-transparent bg-transparent text-navy underline underline-offset-4',
}
const SIZE: Record<Size, string> = {
  md: 'min-h-touch px-5 text-base',
  lg: 'min-h-14 px-8 text-lg',
}

/**
 * 버튼. disabled 대신 aria-disabled 를 쓴다:
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  className,
  onClick,
  children,
  ref,
  ...rest
}: ButtonProps) {
  const inactive = disabled || loading

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (inactive) {
      e.preventDefault() // type="submit" 이어도 폼 제출을 막는다
      return
    }
    onClick?.(e)
  }

  return (
    <button
      ref={ref}
      type={type}
      aria-disabled={inactive || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md border-2 font-bold',
        'aria-pressed:border-navy aria-pressed:bg-navy aria-pressed:text-cream',
        'aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}