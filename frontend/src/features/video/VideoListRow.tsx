import { useId, type Ref } from 'react'
import { Link } from 'react-router-dom'
import { formatDurationShort } from '@/utils/time'
import { Thumbnail } from './Thumbnail'

export interface VideoListRowProps {
  title: string
  /** 출처 줄 ('유튜브 · 채널' / '직접 올린 영상') */
  source: string
  durationSec: number
  thumbnailUrl: string | null
  to: string
  linkRef?: Ref<HTMLAnchorElement>
}

/**
 * 한 열 목록의 영상 한 줄 (홈). ol 안의 li 로 쓴다. 화면 번호는 두지 않고, 낭독기는 목록 위치("10개 중 3번째")로 듣는다.
 * 줄 전체가 링크 하나. 링크 이름은 제목만이라 Tab·링크 목록으로 훑을 때 짧게 읽히고,
 * 출처·길이는 설명(aria-describedby)으로 이어 읽힌다. 제목은 h3 라 H 키로도 넘길 수 있다.
 */
export function VideoListRow({
  title,
  source,
  durationSec,
  thumbnailUrl,
  to,
  linkRef,
}: VideoListRowProps) {
  const titleId = useId()
  const metaId = useId()
  return (
    <Link
      ref={linkRef}
      to={to}
      aria-labelledby={titleId}
      aria-describedby={metaId}
      className="flex items-center gap-5 rounded-lg border-2 border-line bg-paper px-5 py-4 text-ink no-underline"
    >
      <Thumbnail src={thumbnailUrl} className="hidden w-40 shrink-0 rounded-md sm:block" />
      <div className="min-w-0 flex-1">
        <h3
          id={titleId}
          className="text-[1.375rem] leading-snug font-bold break-keep [overflow-wrap:anywhere]"
        >
          {title}
        </h3>
        <p id={metaId} className="mt-1 text-xl break-keep [overflow-wrap:anywhere]">
          {source} · {formatDurationShort(durationSec)}
        </p>
      </div>
    </Link>
  )
}
