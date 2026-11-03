import type { ReactNode } from 'react'
import { formatDurationShort } from '@/utils/time'
import { Thumbnail } from './Thumbnail'
import { cn } from '@/components/ui/cn'

export interface VideoCardProps {
  title: string
  channelTitle?: string | null
  durationSec: number
  thumbnailUrl: string | null
  /** 카드 아래 버튼 줄. 버튼 이름에는 영상 제목을 넣는다 (원칙 4장) */
  actions: ReactNode
  /** 내 영상의 상태·공개 범위처럼 목록에 맞는 메타 정보 */
  metadata?: ReactNode
  /** 제목 길이가 달라도 썸네일과 버튼 사이 정보 덩어리를 세로 중앙에 둔다 */
  centerDetails?: boolean
}

/**
 * 영상 카드 한 장. 목록(ul) 안의 li 로 쓴다.
 * 읽는 순서: 제목(h3) → 채널 → 길이 → 버튼. 썸네일은 숨긴다.
 */
export function VideoCard({
  title,
  channelTitle,
  durationSec,
  thumbnailUrl,
  actions,
  metadata,
  centerDetails = false,
}: VideoCardProps) {
  const subtitleAt = centerDetails ? title.indexOf(' — ') : -1
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border-2 border-line bg-paper">
      <Thumbnail src={thumbnailUrl} className="border-8 border-ink" />
      <div className={cn('flex flex-1 flex-col', centerDetails ? 'px-4 pb-4' : 'px-5 pt-3 pb-5')}>
        <div
          className={cn(centerDetails && 'flex min-h-[8.5rem] flex-1 flex-col justify-center py-2')}
        >
          <h3
            className={cn(
              'font-bold',
              centerDetails
                ? 'text-2xl leading-8 break-keep [overflow-wrap:anywhere]'
                : 'line-clamp-2 text-[1.375rem] leading-tight',
            )}
          >
            {subtitleAt > 0 ? (
              <>
                {title.slice(0, subtitleAt + 1)}
                <br />
                {title.slice(subtitleAt + 1)}
              </>
            ) : (
              title
            )}
          </h3>
          {metadata ?? (
            <>
              {channelTitle && <p className="mt-1 text-xl text-ink">{channelTitle}</p>}
              <p className="text-xl text-ink">{formatDurationShort(durationSec)}</p>
            </>
          )}
        </div>
        <div
          className={cn(
            'mt-auto flex gap-3 pt-1',
            centerDetails ? 'flex-wrap [&>*]:min-w-0' : 'whitespace-nowrap',
          )}
        >
          {actions}
        </div>
      </div>
    </article>
  )
}
