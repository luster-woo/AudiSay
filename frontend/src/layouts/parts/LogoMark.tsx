import { LOGO_PATH, LOGO_VIEWBOX } from './logoPath'

/**
 * AudiSay 로고 아이콘 (말하는 TV). 장식이라 낭독기에서 숨긴다. 글자 크기(1em)를 따라 커진다.
 * 글자색(currentColor)으로 칠해서 고대비 화면에서는 고대비 글자색으로, 남색 바탕(관리자 사이드바·랜딩)에서는 흰색으로 바뀐다
 */
export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={LOGO_VIEWBOX}
      className={`h-[1.15em] w-auto fill-current ${className}`}
    >
      <path fillRule="evenodd" d={LOGO_PATH} />
    </svg>
  )
}
