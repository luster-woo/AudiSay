import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { jobsApi } from '@/api/jobs'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import type { MyVideo } from '@/api/types'
import { useAnnouncer } from '@/features/announcer/context'
import { Thumbnail } from '@/features/video/Thumbnail'

const DONE = ['SUCCEEDED', 'PARTIAL', 'FAILED'] as const

function remainingText(sec: number | null) {
  if (sec == null) return '남은 시간 계산 중'
  if (sec < 60) return '1분 안에 끝나요'
  return `약 ${Math.round(sec / 60)}분 남음`
}

/** 진행률 원. 숫자는 카드 링크 이름에 들어가므로 그림 전체를 숨긴다 */
function Ring({ percent }: { percent: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div aria-hidden="true" className="relative size-14 shrink-0">
      <svg viewBox="0 0 64 64" className="size-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-line" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
          className="stroke-navy"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">
        {percent}%
      </span>
    </div>
  )
}

function ProgressLink({ video }: { video: MyVideo & { jobId: number } }) {
  const queryClient = useQueryClient()
  const { announce } = useAnnouncer()
  const { data: job } = useQuery({
    queryKey: queryKeys.job(video.jobId),
    queryFn: () => jobsApi.get(video.jobId),
    // 홈 카드는 대략적인 진행률만 보여 주면 되므로 SSE 대신 5초마다 확인한다
    refetchInterval: (q) =>
      q.state.data && (DONE as readonly string[]).includes(q.state.data.status) ? false : 5000,
  })

  // 끝났을 때만 읽어 준다 (원칙 2장: 진행 중 숫자는 읽지 않음)
  const prevStatus = useRef(job?.status)
  useEffect(() => {
    const prev = prevStatus.current
    prevStatus.current = job?.status
    if (!job || prev === job.status || !prev) return
    if (job.status === 'FAILED') {
      announce(`${video.title}, 해설을 만들지 못했어요.`, { politeness: 'assertive' })
    } else if (job.status === 'SUCCEEDED' || job.status === 'PARTIAL') {
      announce(`${video.title}, 해설이 준비됐어요.`)
    } else return
    void queryClient.invalidateQueries({ queryKey: ['me', 'videos'] })
  }, [job, video.title, announce, queryClient])

  const percent = Math.round(job?.progress ?? 0)
  const remain = remainingText(job?.estimatedRemainingSec ?? null)

  return (
    <Link
      to={`/jobs/${video.jobId}`}
      aria-label={`해설 만드는 중, ${video.title}, ${percent}%, ${remain}`}
      className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 rounded-lg border-2 border-line bg-paper p-3"
    >
      <Thumbnail src={video.thumbnailUrl} className="border border-line" />
      <p className="line-clamp-3 text-[1.375rem] leading-tight font-bold">{video.title}</p>
      <div className="col-span-2 flex items-center gap-3">
        <Ring percent={percent} />
        <p>
          <span className="block text-xl font-bold text-navy">해설 만드는 중</span>
          <span className="text-xl">{remain}</span>
        </p>
      </div>
    </Link>
  )
}

/** 홈 오른쪽 위: 내가 만들고 있는 해설 1개 (없으면 아무것도 그리지 않음) */
export function JobProgressCard() {
  const { data } = useQuery({
    queryKey: queryKeys.myVideos(0),
    queryFn: () => usersApi.myVideos(0, 20),
  })
  const generating = data?.content.find(
    (v): v is MyVideo & { jobId: number } =>
      v.descriptionStatus === 'GENERATING' && v.jobId != null,
  )
  if (!generating) return null
  return <ProgressLink video={generating} />
}
