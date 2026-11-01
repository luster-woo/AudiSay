/** 소리 막대 4개 로고 아이콘. 장식이라 낭독기에서 숨긴다. 글자 크기(1em)를 따라 커진다 */
export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 22 20"
      className={`h-[0.85em] w-auto fill-current ${className}`}
    >
      <rect x="0" y="6" width="3" height="8" rx="1.5" />
      <rect x="6" y="1" width="3" height="18" rx="1.5" />
      <rect x="12" y="4" width="3" height="12" rx="1.5" />
      <rect x="18" y="7" width="3" height="6" rx="1.5" />
    </svg>
  )
}
