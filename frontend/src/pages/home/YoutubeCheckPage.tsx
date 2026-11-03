import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { videosApi } from '@/api/videos'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import { ApiError, toUserMessage } from '@/api/errors'
import type { Quota, YoutubeCheck } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { cn } from '@/components/ui/cn'
import { Notice } from '@/components/ui/Notice'
import { useAnnouncer } from '@/features/announcer/context'
import { useAuth } from '@/features/auth/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { QuotaAside } from '@/features/video/QuotaAside'
import { RulesDialog } from '@/features/video/RulesDialog'
import { Thumbnail } from '@/features/video/Thumbnail'
import { rejectText } from '@/features/video/youtubeReject'
import { formatDurationShort } from '@/utils/time'

type View = 'ready' | 'can' | 'generating' | 'failed' | 'limit' | 'rejected'

/** 화면 상태 정하기: 확인 결과 + 오늘 남은 횟수 */
function viewOf(check: YoutubeCheck, quota: Quota | undefined): View {
  if (!check.available) return 'rejected'
  if (check.descriptionStatus === 'READY') return 'ready'
  if (check.descriptionStatus === 'GENERATING') return 'generating'
  if (check.descriptionStatus === 'FAILED') return 'failed'
  if (check.willCount && quota?.youtube.remaining === 0) return 'limit'
  return 'can'
}

const HEADINGS: Record<View, string> = {
  ready: '이미 해설이 있는 영상이에요',
  can: '해설을 만들 수 있어요',
  generating: '해설을 만드는 중이에요',
  failed: '해설을 다시 요청할 수 있어요',
  limit: '오늘 해설 만들기 횟수를 다 썼어요',
  rejected: '이 영상은 해설을 만들 수 없어요',
}

/** 유튜브 주소 사전 확인 (/search/youtube?url=) — 확인만 하고 횟수는 쓰지 않는다 */
export default function YoutubeCheckPage() {
  const [params] = useSearchParams()
  const url = (params.get('url') ?? '').trim()
  return <CheckView key={url} url={url} />
}

function CheckView({ url }: { url: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { announce } = useAnnouncer()
  const { user } = useAuth()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [limitHit, setLimitHit] = useState(false)

  const check = useQuery({
    queryKey: queryKeys.youtubeCheck(url),
    queryFn: () => videosApi.youtubeCheck(url),
    enabled: url.length > 0,
    retry: false,
  })
  const quota = useQuery({ queryKey: queryKeys.quota, queryFn: usersApi.quota })

  const maxSec = quota.data?.youtube.maxDurationSec ?? null
  const maxMin = maxSec == null ? null : Math.floor(maxSec / 60)
  const view: View | null = check.data
    ? limitHit
      ? 'limit'
      : viewOf(check.data, quota.data)
    : null
  const reject = rejectText(check.data?.rejectReason ?? null, maxMin)

  const entry: Record<View, string> = {
    ready: '이미 해설이 있는 영상이에요. 횟수를 쓰지 않고 바로 볼 수 있어요.',
    can: '주소를 확인했어요. 해설을 만들 수 있는 영상이에요.',
    generating: '이 영상은 해설을 만드는 중이에요. 횟수를 쓰지 않고 진행 상황을 볼 수 있어요.',
    failed: '지난번에 해설을 만들지 못한 영상이에요. 다시 요청해도 오늘 횟수는 줄지 않아요.',
    limit: '오늘 해설 만들기 횟수를 다 썼어요.',
    rejected: `${reject.short} 해설을 만들 수 없어요.`,
  }
  const badUrl = check.error instanceof ApiError && check.error.code === 'VIDEO_001'

  usePageEntry({
    title: '유튜브 주소 확인',
    announce: view
      ? entry[view]
      : badUrl
        ? '유튜브 주소 형식이 아니에요. 다른 영상 찾기 링크로 돌아가 주세요.'
        : `주소를 확인하지 못했어요. ${toUserMessage(check.error)}`,
    focusRef: headingRef,
    ready: (check.isSuccess && quota.isFetched) || check.isError,
  })

  const request = useMutation({
    mutationFn: (): Promise<{ jobId: number | null; videoId: number }> =>
      view === 'failed' && check.data?.videoId != null
        ? videosApi.retry(check.data.videoId).then((r) => ({ jobId: r.jobId, videoId: r.videoId }))
        : videosApi.youtubeRequest(url),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.quota })
      void queryClient.invalidateQueries({ queryKey: ['me', 'videos'] })
      if (res.jobId != null) navigate(`/jobs/${res.jobId}`)
      else navigate(`/watch/${res.videoId}`)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'LIMIT_001') {
        setLimitHit(true)
        void queryClient.invalidateQueries({ queryKey: queryKeys.quota })
        headingRef.current?.focus()
        announce('오늘 해설 만들기 횟수를 다 썼어요.', { politeness: 'assertive' })
        return
      }
      announce(`해설을 요청하지 못했어요. ${toUserMessage(err)}`, { politeness: 'assertive' })
    },
  })

  const d = check.data

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,55rem)_19.375rem] lg:justify-between">
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="text-4xl font-bold outline-none">
          {view
            ? HEADINGS[view]
            : check.isError
              ? '주소를 확인하지 못했어요'
              : '주소를 확인하는 중이에요'}
        </h1>

        <label htmlFor="youtube-url" className="mt-2 block text-2xl font-bold">
          유튜브 주소
        </label>
        <input
          id="youtube-url"
          readOnly
          value={url}
          className="mt-2 min-h-touch w-full rounded-md border-2 border-navy bg-paper px-5 text-2xl"
        />

        {check.isError && (
          <Notice
            title={badUrl ? '유튜브 주소 형식이 아니에요' : '주소를 확인하지 못했어요'}
            className="mt-8"
          >
            {badUrl
              ? 'youtube.com 이나 youtu.be 로 시작하는 주소를 붙여 넣어 주세요.'
              : toUserMessage(check.error)}
          </Notice>
        )}

        {d && view && view !== 'limit' && (
          <div
            className={cn(
              'mt-8 grid gap-6 rounded-lg border-2 p-4 sm:grid-cols-[minmax(0,26rem)_1fr]',
              view === 'rejected' ? 'border-danger bg-danger-soft' : 'border-line bg-paper',
            )}
          >
            <Thumbnail src={d.thumbnailUrl} className="border-2 border-line" />
            <div className="flex flex-col gap-3 py-4">
              <h2 className="text-[1.75rem] leading-snug font-bold">{d.title}</h2>
              <p className="text-2xl">{d.channelTitle}</p>
              <p className="text-2xl">{formatDurationShort(d.durationSec)}</p>
              {view === 'ready' && <p className="text-2xl font-bold text-navy">해설 있음</p>}
              {view === 'rejected' && (
                <p className="text-2xl font-bold text-danger">해설 만들기 불가</p>
              )}
            </div>
          </div>
        )}

        {view === 'limit' && quota.data && (
          <section
            aria-labelledby="limit-title"
            className="mt-8 rounded-lg border-2 border-danger bg-danger-soft p-10 text-danger"
          >
            <h2 id="limit-title" className="text-[1.75rem] font-bold">
              남은 유튜브 해설 횟수
            </h2>
            <p className="mt-6 text-5xl font-bold">
              <span aria-hidden="true">0 / {quota.data.youtube.limit}</span>
              <span className="sr-only">{quota.data.youtube.limit}번 중 0번 남음</span>
            </p>
            <p className="mt-8 text-2xl">밤 12시(한국 시간)에 다시 채워져요.</p>
            <p className="mt-4 text-2xl">이미 해설이 있는 영상은 계속 볼 수 있어요.</p>
          </section>
        )}

        <div className="mt-8 space-y-3 text-2xl">
          {view === 'ready' && <p>오늘 횟수를 쓰지 않고 바로 볼 수 있어요.</p>}
          {view === 'generating' && (
            <p>다른 분이 먼저 요청했어요. 횟수를 쓰지 않고 함께 기다릴 수 있어요.</p>
          )}
          {view === 'failed' && (
            <p>지난번에 만들지 못했어요. 다시 요청해도 오늘 횟수는 줄지 않아요.</p>
          )}
          {view === 'rejected' && (
            <>
              <p>{reject.detail}</p>
              <p>횟수는 사용하지 않았어요.</p>
              {check.data?.rejectReason === 'TOO_LONG' && user?.role === 'GENERAL' && (
                <p>시각장애인 인증을 하면 더 긴 영상도 해설을 만들 수 있어요.</p>
              )}
            </>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-6">
          {view === 'ready' && d?.videoId != null && (
            <ButtonLink
              to={`/watch/${d.videoId}`}
              variant="accent"
              size="xl"
              className="min-w-[16rem]"
            >
              바로 보기
            </ButtonLink>
          )}
          {(view === 'can' || view === 'generating' || view === 'failed') && (
            <Button
              variant="accent"
              size="xl"
              loading={request.isPending}
              onClick={() => request.mutate()}
              className="min-w-[16rem]"
            >
              {request.isPending
                ? '요청하는 중'
                : view === 'can'
                  ? '해설 만들기'
                  : view === 'generating'
                    ? '진행 상황 보기'
                    : '해설 다시 요청'}
            </Button>
          )}
          {view && (
            <Button
              variant="secondary"
              size="xl"
              onClick={() => setRulesOpen(true)}
              className="min-w-[16rem]"
            >
              이용 조건 보기
            </Button>
          )}
          {/* 어느 상태에서든 맨 끝에 홈(검색 칸)으로 돌아가는 길을 둔다. 할 수 있는 일이 없을 때는 이게 주 버튼 */}
          <ButtonLink
            to="/"
            variant={
              view === 'limit' || view === 'rejected' || check.isError ? 'accent' : 'secondary'
            }
            size="xl"
            className="min-w-[16rem]"
          >
            다른 영상 찾기
          </ButtonLink>
        </div>
      </div>

      <QuotaAside showLeftNote={view !== 'limit'} />
      <RulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} maxMinutes={maxMin} />
    </div>
  )
}
