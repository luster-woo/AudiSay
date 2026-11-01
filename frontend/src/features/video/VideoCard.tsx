import type { ReactNode } from 'react'
import { formatDurationShort } from '@/utils/time'
import { Thumbnail } from './Thumbnail'

export interface VideoCardProps {
  title: string
  channelTitle?: string | null
  durationSec: number
  thumbnailUrl: string | null
  /** 카드 아래 버튼 줄. 버튼 이름에는 영상 제목을 넣는다 (원칙 4장) */
  actions: ReactNode
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
}: VideoCardProps) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border-2 border-line bg-paper">
      <Thumbnail src={thumbnailUrl} className="border-8 border-ink" />
      <div className="flex flex-1 flex-col px-5 pt-3 pb-5">
        <h3 className="line-clamp-2 text-[1.375rem] leading-tight font-bold">{title}</h3>
        {channelTitle && <p className="mt-1 text-xl text-ink">{channelTitle}</p>}
        <p className="text-xl text-ink">{formatDurationShort(durationSec)}</p>
        <div className="mt-auto flex gap-3 pt-1 whitespace-nowrap">{actions}</div>
      </div>
    </article>
  )
}
