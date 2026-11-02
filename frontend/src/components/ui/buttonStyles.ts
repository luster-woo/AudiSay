import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost' | 'on' | 'muted'
/** sm 관리자 화면 (길잡이: 관리자 40px) · md 기본 · lg 폼 제출 · xl 홈·영상 화면의 큰 버튼 (Figma 22px) */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

const VARIANT: Record<ButtonVariant, string> = {
  // 남색 버튼은 전역 포커스 배경(연노랑)이 글자를 가리므로 배경을 유지한다
  primary: 'border-navy bg-navy text-cream focus-visible:bg-navy-deep',
  secondary: 'border-navy bg-paper text-navy',
  accent: 'border-navy bg-yellow text-navy focus-visible:bg-yellow',
  danger: 'border-danger bg-paper text-danger',
  ghost: 'border-transparent bg-transparent text-navy underline underline-offset-4',
  // 켜진 상태(즐겨찾기 해제). 색만이 아니라 이름도 바뀐다 (원칙 4·10장)
  on: 'border-navy bg-yellow-soft text-navy',
  // 누를 수 없는 안내용 ('만들 수 없음')
  muted: 'border-line bg-cream text-ink',
}
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-[2.6rem] px-4 text-[0.9333rem]',
  md: 'min-h-touch px-5 text-base',
  lg: 'min-h-14 px-8 text-lg',
  xl: 'min-h-touch px-6 text-[1.375rem]',
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
