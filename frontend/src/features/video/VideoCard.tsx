import type { ReactNode } from 'react'
import { formatDurationShort } from '@/utils/time'
import { Thumbnail } from './Thumbnail'
import { cn } from '@/components/ui/cn'

export interface VideoCardProps {
  title: string
  channelTitle?: string | null
  durationSec: number
  thumbnailUrl: string | null
  /** 내 영상의 상태·공개 범위처럼 목록에 맞는 메타 정보 */
  metadata?: ReactNode
  /** 제목 길이가 달라도 썸네일과 버튼 사이 정보 덩어리를 세로 중앙에 둔다 */
  centerDetails?: boolean
  /** 카드 아래 버튼 줄. 버튼 이름에는 영상 제목을 넣는다 (원칙 4장) */
  actions: ReactNode
  /** 한 열 목록용 가로 배치: 썸네일 · 제목/정보 · 버튼(세로로 쌓음). 제목은 코드가 포커스를 옮길 수 있게 tabIndex=-1 */
  row?: boolean
}

/**
 * 정보 카드 + 버튼 줄 (내 영상처럼 동작이 둘 이상이거나 되돌리기 어려운 동작이 있을 때). 목록(ul) 안의 li 로 쓴다.
 * 읽는 순서: 제목(h3) → 채널 → 길이 → 버튼.
 * 카드 전체가 링크 하나인 목록(홈·검색 결과)은 VideoListRow 를 쓴다.
 */
export function VideoCard(props: VideoCardProps) {
  const { title, channelTitle, durationSec, thumbnailUrl, metadata, centerDetails = false } = props
  const subtitleAt = centerDetails ? title.indexOf(' — ') : -1
  const heading = (
    <h3
      className={cn(
        'font-bold',
        centerDetails ? 'text-2xl leading-8' : 'line-clamp-2 text-[1.375rem] leading-tight',
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
  )
  const details = metadata ?? (
    <>
      {/* 채널 이름은 한 줄. 길면 … 으로 줄이고 전체는 마우스를 올리면 보인다 (링크 이름에는 전체가 읽힌다) */}
      {channelTitle && (
        <p className="mt-1 truncate text-xl text-ink" title={channelTitle}>
          {channelTitle}
        </p>
      )}
      <p className="text-xl text-ink">{formatDurationShort(durationSec)}</p>
    </>
  )

  if (props.row) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border-2 border-line bg-paper px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
        <Thumbnail
          src={thumbnailUrl}
          sizes="10rem"
          className="hidden w-40 shrink-0 rounded-md sm:block"
        />
        <div className="min-w-0 flex-1">
          <h3 tabIndex={-1} className="text-[1.375rem] leading-snug font-bold outline-none">
            {title}
          </h3>
          <div className="mt-1">{details}</div>
        </div>
        {/* 버튼은 오른쪽에 같은 폭으로 세로로 쌓는다. 버튼 이름에는 영상 제목이 들어 있다 */}
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-[12rem] [&>*]:w-full [&>*]:flex-none">
          {props.actions}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border-2 border-line bg-paper">
      <Thumbnail src={thumbnailUrl} className="border-8 border-ink" />
      <div className={cn('flex flex-1 flex-col', centerDetails ? 'px-4 pb-4' : 'px-5 pt-3 pb-5')}>
        <div
          className={cn(centerDetails && 'flex min-h-[8.5rem] flex-1 flex-col justify-center py-2')}
        >
          {heading}
          {details}
        </div>
        <div
          className={cn(
            'mt-auto flex gap-3 pt-1',
            centerDetails ? 'flex-wrap [&>*]:min-w-0' : 'whitespace-nowrap',
          )}
        >
          {props.actions}
        </div>
      </div>
    </div>
  )
}
