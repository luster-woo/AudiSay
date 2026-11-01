import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost'
export type ButtonSize = 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  // 남색 버튼은 전역 포커스 배경(연노랑)이 글자를 가리므로 배경을 유지한다
  primary: 'border-navy bg-navy text-cream focus-visible:bg-navy-deep',
  secondary: 'border-navy bg-paper text-navy',
  accent: 'border-yellow bg-yellow text-navy focus-visible:bg-yellow',
  danger: 'border-danger bg-paper text-danger',
  ghost: 'border-transparent bg-transparent text-navy underline underline-offset-4',
}
const SIZE: Record<ButtonSize, string> = {
  md: 'min-h-touch px-5 text-base',
  lg: 'min-h-14 px-8 text-lg',
}

/** Button 과 ButtonLink 가 같은 모양을 쓰도록 클래스를 한 곳에서 만든다 */
export function buttonClass(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md border-2 font-bold',
    'aria-pressed:border-navy aria-pressed:bg-navy aria-pressed:text-cream',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
    VARIANT[variant],
    SIZE[size],
    className,
  )
}
