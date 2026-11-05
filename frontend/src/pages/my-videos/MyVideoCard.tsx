import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { videosApi } from '@/api/videos'
import { queryKeys } from '@/api/queryKeys'
import { ApiError, toUserMessage } from '@/api/errors'
import type { MyVideo, Paged, VideoDetail, Visibility } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { useAnnouncer } from '@/features/announcer/context'
import { VideoCard } from '@/features/video/VideoCard'
import { formatDurationShort } from '@/utils/time'

/** 목록 응답에는 없는 채널·소유 여부·공개 범위는 상세 API에서 확인한다. */
export function MyVideoCard({ video }: { video: MyVideo }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const { announce } = useAnnouncer()
  const detail = useQuery({
    queryKey: queryKeys.video(video.videoId),
    queryFn: () => videosApi.get(video.videoId),
    enabled: video.available,
  })
  const inaccessible = detail.error instanceof ApiError && [403, 404].includes(detail.error.status)
  const available = video.available && !inaccessible && detail.data?.status !== 'UNAVAILABLE'
  const ready = video.descriptionStatus === 'READY' || !!detail.data?.descriptionId

  const retry = useMutation({
    mutationFn: () => videosApi.retry(video.videoId),
    onSuccess: (result) => {
      client.setQueriesData<Paged<MyVideo>>(
        { queryKey: ['me', 'videos'] },
        (old) =>
          old && {
            ...old,
            content: old.content.map((item) =>
              item.videoId === video.videoId
                ? { ...item, descriptionStatus: 'GENERATING', jobId: result.jobId }
                : item,
            ),
          },
      )
      void client.invalidateQueries({ queryKey: queryKeys.video(video.videoId) })
      announce(`${video.title}, 해설을 다시 요청했어요. 오늘 횟수는 줄지 않아요.`)
      navigate(`/jobs/${result.jobId}`)
    },
    onError: (error) =>
      announce(`다시 요청하지 못했어요. ${toUserMessage(error)}`, { politeness: 'assertive' }),
  })
  const visibility = useMutation({
    mutationFn: (value: Visibility) => videosApi.updateVisibility(video.videoId, value),
    onSuccess: (result) => {
      client.setQueryData<VideoDetail>(
        queryKeys.video(video.videoId),
        (old) => old && { ...old, visibility: result.visibility },
      )
      void client.invalidateQueries({ queryKey: ['favorites'] })
      void client.invalidateQueries({
        queryKey: ['videos'],
        predicate: (q) => typeof q.queryKey[1] === 'object',
      })
      announce(`${video.title}, ${result.visibility === 'PRIVATE' ? '비공개' : '공개'}로 바꿨어요.`)
    },
    onError: (error) =>
      announce(`공개 범위를 바꾸지 못했어요. ${toUserMessage(error)}`, { politeness: 'assertive' }),
  })

  const status = !available
    ? '재생 불가'
    : video.descriptionStatus === 'GENERATING'
      ? '해설 만드는 중'
      : ready
        ? '해설 있음'
        : video.descriptionStatus === 'FAILED'
          ? '만들기 실패'
          : '해설 없음'
  const privateUpload = detail.data?.visibility === 'PRIVATE'
  const channel =
    video.sourceType === 'UPLOAD'
      ? `직접 올린 영상${detail.data?.isOwner ? ` · ${privateUpload ? '비공개' : '공개'}` : ''}`
      : detail.data?.channelTitle && `유튜브 · ${detail.data.channelTitle}`
  const error = retry.error ?? visibility.error

  return (
    <VideoCard
      {...video}
      row
      metadata={
        <>
          {channel && <p className="text-xl leading-8">{channel}</p>}
          <div className="flex flex-wrap items-baseline gap-x-4 text-xl leading-8">
            <p>{formatDurationShort(video.durationSec)}</p>
            <p
              className={`font-bold ${!available || video.descriptionStatus === 'FAILED' ? 'text-danger' : 'text-navy'}`}
            >
              {status}
            </p>
          </div>
          {!available && <p className="mt-1 text-lg text-danger">더 이상 볼 수 없는 영상이에요.</p>}
          {error && <p className="mt-2 text-lg text-danger">{toUserMessage(error)}</p>}
        </>
      }
      actions={
        <>
          {!available ? (
            <Button
              variant="muted"
              size="xl"
              disabled
              className="w-full"
              aria-label={`재생 불가, ${video.title}`}
            >
              재생 불가
            </Button>
          ) : video.descriptionStatus === 'GENERATING' && video.jobId ? (
            <ButtonLink
              to={`/jobs/${video.jobId}`}
              size="xl"
              className="w-full"
              aria-label={`진행 상황 보기, ${video.title}`}
            >
              진행 상황 보기
            </ButtonLink>
          ) : ready ? (
            <ButtonLink
              to={`/watch/${video.videoId}`}
              variant="primary"
              size="xl"
              className="flex-1 px-4"
              aria-label={`재생, ${video.title}`}
            >
              재생
            </ButtonLink>
          ) : video.descriptionStatus === 'FAILED' ? (
            <Button
              size="xl"
              variant="secondary"
              className="w-full"
              loading={retry.isPending}
              aria-label={`다시 요청, ${video.title}`}
              onClick={() => retry.mutate()}
            >
              {retry.isPending ? '요청 중' : '다시 요청'}
            </Button>
          ) : (
            <Button
              size="xl"
              variant="muted"
              className="w-full"
              disabled
              aria-label={`해설 없음, ${video.title}`}
            >
              해설 없음
            </Button>
          )}
          {available && ready && video.sourceType === 'UPLOAD' && detail.data?.isOwner && (
            <Button
              size="xl"
              variant="secondary"
              className="flex-1 px-3"
              loading={visibility.isPending}
              aria-label={`${privateUpload ? '공개로' : '비공개로'}, ${video.title}`}
              onClick={() => visibility.mutate(privateUpload ? 'PUBLIC' : 'PRIVATE')}
            >
              {privateUpload ? '공개로' : '비공개로'}
            </Button>
          )}
          {available && detail.isError && !inaccessible && (
            <Button
              size="md"
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
