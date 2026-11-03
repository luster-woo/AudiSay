import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatDurationShort } from '@/utils/time'
import { Thumbnail } from './Thumbnail'
import { cn } from '@/components/ui/cn'

interface VideoCardBase {
  title: string
  channelTitle?: string | null
  durationSec: number
  thumbnailUrl: string | null
  /** 내 영상의 상태·공개 범위처럼 목록에 맞는 메타 정보 */
  metadata?: ReactNode
  /** 제목 길이가 달라도 썸네일과 버튼 사이 정보 덩어리를 세로 중앙에 둔다 */
  centerDetails?: boolean
}

/** 카드 전체가 링크 하나 (홈·검색 결과). 버튼은 두지 않는다 */
export interface VideoCardLinkProps extends VideoCardBase {
  /** 카드를 누르면 가는 곳. 재생(/watch/:id) 또는 주소 확인(/search/youtube?url=) */
  to: string
  /** 카드 맨 아래 상태 한 줄 (예: '해설 있음', '해설 만들 수 없음, 5분 넘음'). 링크 이름에 함께 읽힌다 */
  status?: string
  /** 만들 수 없는 영상은 빨간 테두리로도 구분한다 */
  tone?: 'normal' | 'danger'
  actions?: never
}

/** 정보 카드 + 아래 버튼 줄 (내 영상처럼 동작이 둘 이상이거나 되돌리기 어려운 동작이 있을 때) */
export interface VideoCardActionsProps extends VideoCardBase {
  /** 카드 아래 버튼 줄. 버튼 이름에는 영상 제목을 넣는다 (원칙 4장) */
  actions: ReactNode
  to?: never
  status?: never
  tone?: never
}

export type VideoCardProps = VideoCardLinkProps | VideoCardActionsProps

/**
 * 영상 카드 한 장. 목록(ul) 안의 li 로 쓴다. 썸네일은 숨긴다.
 * - `to` 가 있으면 카드 전체가 링크 하나: 낭독기에 "링크, 제목, 채널, 길이, 상태"가 한 번에 읽히고 Enter 로 연다.
 *   제목은 h3 로 두어 제목 탐색(H 키)도 된다.
 * - `actions` 가 있으면 읽는 순서: 제목(h3) → 채널 → 길이 → 버튼.
 */
export function VideoCard(props: VideoCardProps) {
  const { title, channelTitle, durationSec, thumbnailUrl, metadata, centerDetails = false } = props
  const subtitleAt = centerDetails ? title.indexOf(' — ') : -1
  const heading = (
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
  )
  const details = metadata ?? (
    <>
      {channelTitle && <p className="mt-1 text-xl text-ink">{channelTitle}</p>}
      <p className="text-xl text-ink">{formatDurationShort(durationSec)}</p>
    </>
  )

  if (props.to != null) {
    const tone = props.tone ?? 'normal'
    return (
      <Link
        to={props.to}
        className={cn(
          'flex h-full flex-col overflow-hidden rounded-lg border-2 bg-paper text-ink no-underline',
          tone === 'danger' ? 'border-danger' : 'border-line',
        )}
      >
        <Thumbnail src={thumbnailUrl} className="border-8 border-ink" />
        <div className="flex flex-1 flex-col px-5 pt-3 pb-5">
          {heading}
          {details}
          {props.status && (
            <p
              className={cn(
                'mt-auto pt-3 text-xl font-bold',
                tone === 'danger' ? 'text-danger' : 'text-navy',
              )}
            >
              {props.status}
            </p>
          )}
        </div>
      </Link>
    )
  }

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border-2 border-line bg-paper">
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
    </article>
  )
}
