import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { favoritesApi } from '@/api/favorites'
import { videosApi } from '@/api/videos'
import { queryKeys } from '@/api/queryKeys'
import { ApiError, toUserMessage } from '@/api/errors'
import type { FavoriteVideo, Paged, VideoDetail, VideoSummary } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { useAnnouncer } from '@/features/announcer/context'
import { VideoCard } from '@/features/video/VideoCard'
import { formatDurationShort } from '@/utils/time'

export function FavoriteVideoCard({
  video,
  onRemoved,
}: {
  video: FavoriteVideo
  onRemoved: () => void
}) {
  const client = useQueryClient()
  const { announce } = useAnnouncer()
  const detail = useQuery({
    queryKey: queryKeys.video(video.videoId),
    queryFn: () => videosApi.get(video.videoId),
    enabled: video.available,
  })
  const inaccessible = detail.error instanceof ApiError && [403, 404].includes(detail.error.status)
  const available = video.available && !inaccessible && detail.data?.status !== 'UNAVAILABLE'
  const ready = video.hasDescription || !!detail.data?.descriptionId
  const sourceUrl = detail.data?.youtubeVideoId
    ? `https://www.youtube.com/watch?v=${detail.data.youtubeVideoId}`
    : null
  const remove = useMutation({
    mutationFn: () => favoritesApi.remove(video.videoId),
    onSuccess: () => {
      // 삭제한 카드가 사라지기 전에 목록 제목으로 옮겨 초점이 body로 빠지지 않게 한다.
      onRemoved()
      client.setQueriesData<Paged<FavoriteVideo>>(
        { queryKey: ['favorites'] },
        (old) =>
          old && {
            ...old,
            content: old.content.filter((item) => item.videoId !== video.videoId),
            page: {
              ...old.page,
              totalElements: Math.max(0, old.page.totalElements - 1),
              totalPages: Math.ceil(Math.max(0, old.page.totalElements - 1) / old.page.size),
            },
          },
      )
      client.setQueriesData<Paged<VideoSummary>>({ queryKey: ['videos'] }, (old) =>
        old && 'content' in old
          ? {
              ...old,
              content: old.content.map((item) =>
                item.videoId === video.videoId ? { ...item, isFavorite: false } : item,
              ),
            }
          : old,
      )
      client.setQueryData<VideoDetail>(
        queryKeys.video(video.videoId),
        (old) => old && { ...old, isFavorite: false },
      )
      void client.invalidateQueries({ queryKey: ['favorites'] })
      announce(`${video.title}, 즐겨찾기를 해제했어요.`)
    },
    onError: (error) =>
      announce(`즐겨찾기를 해제하지 못했어요. ${toUserMessage(error)}`, {
        politeness: 'assertive',
      }),
  })
  return (
    <VideoCard
      {...video}
      row
      metadata={
        <>
          {available && (
            <>
              <p className="text-xl leading-8">
                {video.sourceType === 'UPLOAD'
                  ? '직접 올린 영상'
                  : detail.data?.channelTitle && `유튜브 · ${detail.data.channelTitle}`}
              </p>
              <div className="flex flex-wrap items-baseline gap-x-4 text-xl leading-8">
                <p>{formatDurationShort(video.durationSec)}</p>
                <p className="font-bold text-navy">{ready ? '해설 있음' : '해설 없음'}</p>
              </div>
            </>
          )}
          {!available && (
            <p className="text-xl leading-8 text-danger">더 이상 볼 수 없는 영상이에요.</p>
          )}
          {remove.isError && (
            <p className="mt-2 text-lg text-danger">{toUserMessage(remove.error)}</p>
          )}
        </>
      }
      actions={
        <>
          {!available ? (
            <Button
              variant="muted"
              size="xl"
              disabled
              className="flex-1 px-3"
              aria-label={`재생 불가, ${video.title}`}
            >
              재생 불가
            </Button>
          ) : ready ? (
            <ButtonLink
              to={`/watch/${video.videoId}`}
              variant="primary"
              size="xl"
              className="flex-1 px-3"
              aria-label={`재생, ${video.title}`}
            >
              재생
            </ButtonLink>
          ) : detail.data?.activeJobId ? (
            <ButtonLink
              to={`/jobs/${detail.data.activeJobId}`}
              size="xl"
              className="flex-1 px-3"
              aria-label={`진행 상황 보기, ${video.title}`}
            >
              진행 상황
            </ButtonLink>
          ) : sourceUrl ? (
            <ButtonLink
              to={`/search/youtube?url=${encodeURIComponent(sourceUrl)}`}
              size="xl"
              className="flex-1 px-3"
              aria-label={`해설 만들기, ${video.title}`}
            >
              해설 만들기
            </ButtonLink>
          ) : (
            <Button
              variant="muted"
              size="xl"
              disabled
              className="flex-1 px-3"
              aria-label={`${detail.isPending ? '영상 확인 중' : '해설 없음'}, ${video.title}`}
            >
              {detail.isPending ? '확인 중' : '해설 없음'}
            </Button>
          )}
          <Button
            variant="on"
            size="xl"
            className="px-3"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
            aria-label={`즐겨찾기 해제, ${video.title}`}
          >
            해제
          </Button>
          {available && detail.isError && !inaccessible && (
            <Button
              variant="secondary"
              className="w-full"
              loading={detail.isFetching}
              onClick={() => void detail.refetch()}
              aria-label={`영상 정보 다시 확인, ${video.title}`}
            >
              영상 정보 다시 확인
            </Button>
          )}
        </>
      }
    />
  )
}
