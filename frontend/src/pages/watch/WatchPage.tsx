import { useRef } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { favoritesApi } from '@/api/favorites'
import { queryKeys } from '@/api/queryKeys'
import { videosApi } from '@/api/videos'
import { ApiError, toUserMessage } from '@/api/errors'
import type { VideoDetail } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { Thumbnail } from '@/features/video/Thumbnail'
import { CATEGORY_LABELS } from '@/features/video/categories'
import { formatDurationShort } from '@/utils/time'
import { Player } from './Player'

/** /watch/:videoId — 영상 정보를 받아 상태에 맞는 화면을 고른다 */
export default function WatchRoute() {
  const { videoId } = useParams()
  const id = Number(videoId)
  // 영상이 바뀌면 플레이어를 처음부터 다시 만든다 (소리·상태가 섞이지 않게)
  return <WatchPage key={videoId} videoId={Number.isInteger(id) && id > 0 ? id : null} />
}

function WatchPage({ videoId }: { videoId: number | null }) {
  const videoQ = useQuery({
    queryKey: queryKeys.video(videoId ?? 0),
    queryFn: () => videosApi.get(videoId!),
    enabled: videoId !== null,
  })

  if (videoId === null) return <Notice title="없는 영상이에요" text="주소가 올바르지 않아요." />
  if (videoQ.isError) {
    const code = videoQ.error instanceof ApiError ? videoQ.error.code : ''
    return (
      <Notice
        title={code === 'VIDEO_007' ? '볼 수 없는 영상이에요' : '영상을 불러오지 못했어요'}
        text={toUserMessage(videoQ.error)}
      />
    )
  }
  if (!videoQ.data) return <p className="text-2xl">불러오는 중이에요.</p>

  const video = videoQ.data
  if (video.status === 'UNAVAILABLE') return <UnavailableView video={video} />
  if (video.descriptionId == null) {
    if (video.activeJobId != null) return <Navigate to={`/jobs/${video.activeJobId}`} replace />
    return (
      <Notice
        title="아직 해설이 없는 영상이에요"
        text="해설을 만든 뒤에 볼 수 있어요. 홈에서 해설이 준비된 영상을 골라 주세요."
      />
    )
  }
  // 영상이 바뀌면 화면 상태(질문 기록·요약 단계 등)를 새로 시작한다
  return <Player key={video.videoId} video={video} />
}

function Notice({ title, text }: { title: string; text: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  usePageEntry({ title, announce: `${title}. ${text} 홈으로 가기 링크에 있어요.`, focusRef: ref })
  return (
    <div className="max-w-[60rem]">
      <p className="text-2xl font-bold text-navy">영상 보기</p>
      <h1 ref={ref} tabIndex={-1} className="mt-6 text-[2.75rem] font-bold outline-none">
        {title}
      </h1>
      <p className="mt-6 text-2xl">{text}</p>
      <ButtonLink to="/" variant="primary" size="xl" className="mt-10">
        홈으로 가기
      </ButtonLink>
    </div>
  )
}

/**
 * 유튜브에서 삭제·비공개로 바뀐 영상 (CVN-01). 즐겨찾기에서 뺄지 묻고, 옆에 볼 수 있는 영상을 보여 준다.
 */
function UnavailableView({ video }: { video: VideoDetail }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { announce } = useAnnouncer()
  const ref = useRef<HTMLHeadingElement>(null)
  usePageEntry({
    title: video.title,
    announce: video.isFavorite
      ? '더 이상 볼 수 없는 영상이에요. 즐겨찾기에서 빼기 버튼에 있어요.'
      : '더 이상 볼 수 없는 영상이에요. 홈으로 링크에 있어요.',
    focusRef: ref,
  })
  const ready = useQuery({
    queryKey: queryKeys.videos({ page: 0, size: 3 }),
    queryFn: () => videosApi.list({ page: 0, size: 3 }),
  })
  const remove = useMutation({
    mutationFn: () => favoritesApi.remove(video.videoId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['videos'] })
      void queryClient.invalidateQueries({ queryKey: ['favorites'] })
      void queryClient.invalidateQueries({ queryKey: ['me', 'videos'] })
      announce(`${video.title}, 즐겨찾기에서 뺐어요. 홈으로 가요.`)
      navigate('/')
    },
    onError: (e) =>
      announce(`즐겨찾기에서 빼지 못했어요. ${toUserMessage(e)}`, { politeness: 'assertive' }),
  })

  return (
    <div className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_33.5rem]">
      <div>
        <p className="text-xl font-bold">즐겨찾기</p>
        <p className="mt-10 text-xl text-ink-muted">영상 보기</p>
        <h1 ref={ref} tabIndex={-1} className="mt-2 text-[2.75rem] font-bold outline-none">
          {video.title}
        </h1>
        <div
          role="alert"
          className="mt-10 rounded-lg border-2 border-ink border-l-8 bg-paper px-8 py-6"
        >
          <p className="text-2xl font-bold">더 이상 볼 수 없는 영상이에요</p>
          <p className="mt-3 text-2xl">
            유튜브에서 삭제되었거나 비공개로 바뀌었어요.
            {video.isFavorite && ' 즐겨찾기에서 빼 둘까요?'}
          </p>
        </div>
        <div className="mt-8 flex flex-wrap gap-4">
          {video.isFavorite && (
            <Button
              variant="accent"
              size="xl"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              aria-label={`즐겨찾기에서 빼기, ${video.title}`}
            >
              즐겨찾기에서 빼기
            </Button>
          )}
          <ButtonLink to="/" variant="secondary" size="xl">
            홈으로
          </ButtonLink>
        </div>
      </div>
      <aside aria-labelledby="ready-title" className="border-t-2 border-line pt-6">
        <h2 id="ready-title" className="text-2xl font-bold">
          해설이 준비된 영상
        </h2>
        <ul className="mt-4 divide-y divide-line">
          {(ready.data?.content ?? []).map((v) => (
            <li key={v.videoId} className="py-4">
              <Link
                to={`/watch/${v.videoId}`}
                aria-label={`재생, ${v.title}, ${formatDurationShort(v.durationSec)}`}
                className="flex min-h-touch items-center gap-5 rounded-md"
              >
                <Thumbnail src={v.thumbnailUrl} className="w-32 shrink-0 rounded-md" />
                <span className="min-w-0">
                  <span className="block text-lg font-bold text-ink">{v.title}</span>
                  <span className="block text-ink-muted">
                    {formatDurationShort(v.durationSec)} · {CATEGORY_LABELS[v.category]}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
