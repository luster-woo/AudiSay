import { Link, type LinkProps } from 'react-router-dom'
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonStyles'

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant
  size?: ButtonSize
}

/** 버튼 모양의 링크. '회원가입하기', '이미 회원이에요' 처럼 화면을 옮길 때 쓴다 */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      className={buttonClass(variant, size, typeof className === 'string' ? className : undefined)}
      {...rest}
    />
  )
}
