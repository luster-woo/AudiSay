import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react'
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonStyles'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary 남색 · secondary 흰 바탕 · accent 노랑(다음·신청) · danger 빨강(반려·다시 만들기) · ghost 밑줄 링크형 */
  variant?: ButtonVariant
  size?: ButtonSize
  /** 처리 중. 누를 수 없고 낭독기에 '사용 중'으로 알린다 */
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
}

/**
 * 버튼. disabled 대신 aria-disabled 를 쓴다:
 * 진짜 disabled 는 Tab 순서에서 빠져서 낭독기 사용자가 버튼이 있다는 것 자체를 모르게 된다.
 * 화면 이동은 버튼이 아니라 ButtonLink 를 쓴다 (원칙 4장: 링크는 이동, 버튼은 동작).
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
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {children}
    </button>
  )
}
