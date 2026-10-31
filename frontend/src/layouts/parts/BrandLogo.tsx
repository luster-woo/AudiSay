import { Link } from 'react-router-dom'

export function BrandLogo({ to = '/', subtitle }: { to?: string; subtitle?: string }) {
  return (
    <Link to={to} className="flex items-baseline gap-3 rounded-sm">
      <span className="text-2xl font-bold text-navy">
        AudiSay<span className="sr-only"> 홈</span>
      </span>
      {subtitle && <span className="text-sm text-ink-muted">{subtitle}</span>}
    </Link>
  )
}