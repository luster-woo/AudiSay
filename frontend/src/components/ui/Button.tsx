import { useEffect, useState, type ButtonHTMLAttributes, type MouseEvent, type Ref } from 'react'
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonStyles'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary 남색 · secondary 흰 바탕 · accent 노랑(다음·신청) · danger 빨강(반려·다시 만들기) · ghost 밑줄 링크형 */
  variant?: ButtonVariant
  size?: ButtonSize
  /** 처리 중. 누를 수 없고 낭독기에 '사용 중'으로 알린다 */
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
}

/** 처리 중(loading)을 낭독기·화면에 알리기까지 기다리는 시간 */
const LOADING_SHOW_DELAY_MS = 800

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
  // 짧은 요청(공개 범위 바꾸기, 더 보기 등)의 처리 중은 낭독기에 바로 알리지 않는다: 1초도 안 돼 끝나는데
  // "사용불가, 작업 중"이 끼어들어 결과 안내를 가린다 (11-09 NVDA 실측). 누름은 즉시 막고, 표시만 늦춘다
  const [shownLoading, setShownLoading] = useState(false)
  if (!loading && shownLoading) setShownLoading(false) // 끝나면 즉시 되돌린다
  useEffect(() => {
    if (!loading) return
    const id = window.setTimeout(() => setShownLoading(true), LOADING_SHOW_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [loading])

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
      aria-disabled={disabled || shownLoading || undefined}
      aria-busy={shownLoading || undefined}
      onClick={handleClick}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {children}
    </button>
  )
}
