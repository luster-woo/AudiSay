import { Link } from 'react-router-dom'
import { LogoMark } from './LogoMark'

/** 로고. 링크 이름은 "AudiSay 홈" 으로 읽힌다 */
export function BrandLogo({ to = '/', subtitle }: { to?: string; subtitle?: string }) {
  return (
    // 이름은 aria-label 로 정한다. 안쪽 글자를 이어 붙이면 'AudiSay홈화면해설 플레이어' 처럼 띄어쓰기 없이 읽혔다
    <Link to={to} aria-label="AudiSay 홈" className="flex items-center gap-3 rounded-sm">
      <span className="flex items-center gap-2 text-3xl font-bold text-navy">
        <LogoMark />
        AudiSay
      </span>
      {/* 좁은 화면에서는 부제를 술겨 로고가 한 줄에 들어가게 한다 (링크 이름은 aria-label 이라 낭독에는 영향 없음) */}
      {subtitle && <span className="text-lg text-ink-muted max-[46rem]:hidden">{subtitle}</span>}
    </Link>
  )
}
