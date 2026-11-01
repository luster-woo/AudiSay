import { Link } from 'react-router-dom'
import { LogoMark } from './LogoMark'

/** 로고. 링크 이름은 "AudiSay 홈" 으로 읽힌다 */
export function BrandLogo({ to = '/', subtitle }: { to?: string; subtitle?: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-sm">
      <span className="flex items-center gap-2 text-2xl font-bold text-navy">
        <LogoMark />
        AudiSay<span className="sr-only"> 홈</span>
      </span>
      {subtitle && <span className="text-sm text-ink-muted">{subtitle}</span>}
    </Link>
  )
}
