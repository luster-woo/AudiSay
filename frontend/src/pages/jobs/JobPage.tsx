import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { jobsApi } from '@/api/jobs'
import { videosApi } from '@/api/videos'
import { queryKeys } from '@/api/queryKeys'
import { subscribeSse } from '@/api/sse'
import { JOB_ERROR_MESSAGES, toUserMessage } from '@/api/errors'
import type { Job, JobEvent } from '@/api/types'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useAnnouncer } from '@/features/announcer/context'
import { STAGE_NAME, useProgressAnnounce } from '@/features/announcer/useProgressAnnounce'
import { StatusDialog } from '@/features/upload/StatusDialog'
import { formatDurationSpoken } from '@/utils/time'

const POLL_MS = 5_000

type Phase = 'waiting' | 'running' | 'done' | 'failed'

function phaseOf(job: Job): Phase {
  switch (job.status) {
    case 'QUEUED':
      return 'waiting'
    case 'RUNNING':
      return 'running'
    case 'SUCCEEDED':
    case 'PARTIAL':
      return 'done'
    case 'FAILED':
      return 'failed'
  }
}

const isFinished = (job: Job | undefined) =>
  !!job && (phaseOf(job) === 'done' || phaseOf(job) === 'failed')

/** SSE 이벤트 하나를 캐시에 든 작업에 합친다 */
function mergeEvent(job: Job, msg: JobEvent): Job {
  if (msg.event === 'progress') return { ...job, ...msg.data }
  if (msg.event === 'completed')
    return { ...job, ...msg.data, progress: 100, estimatedRemainingSec: 0 }
  return {
    ...job,
    status: msg.data.status,
    errorCode: msg.data.errorCode,
    retryable: msg.data.retryable,
  }
}

function parseEvent(event: string, data: string): JobEvent | null {
  if (event !== 'progress' && event !== 'completed' && event !== 'failed') return null
  try {
    return { event, data: JSON.parse(data) } as JobEvent
  } catch {
    return null
  }
}

function remainingText(job: Job) {
  if (job.status === 'QUEUED') return '차례를 기다리고 있어요. 곧 시작해요.'
  const sec = job.estimatedRemainingSec
  if (sec == null) return '남은 시간을 계산하고 있어요'
  if (sec < 10) return '거의 다 됐어요'
  return `약 ${formatDurationSpoken(sec)} 남았어요`
}

function elapsedText(job: Job) {
  if (!job.startedAt || !job.finishedAt) return '다 만들었어요'
  const sec = (Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000
  return `다 만들었어요 · ${formatDurationSpoken(sec)} 걸렸어요`
}

/**
 * 해설 만들기 진행 화면 (/jobs/:jobId).
 * 처음엔 GET /jobs/{id} 로 상태를 받고, 이어서 SSE 로 진행률을 받는다.
 * SSE 가 끊기면(heartbeat 없음·네트워크 오류) 5초마다 GET 으로 바꿔 끝까지 따라간다.
 */
export default function JobRoute() {
  const { jobId } = useParams()
  // 다시 요청하면 새 jobId 로 주소가 바뀐다. 화면 상태(나중에 보기·폴링)를 처음부터 시작하게 key 를 준다
  return <JobPage key={jobId} jobId={Number(jobId)} />
}

function JobPage({ jobId }: { jobId: number }) {
  const validId = Number.isInteger(jobId) && jobId > 0
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { announce } = useAnnouncer()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [polling, setPolling] = useState(false)
  const [laterChosen, setLaterChosen] = useState(false)

  const jobQuery = useQuery({
    queryKey: queryKeys.job(jobId),
    queryFn: () => jobsApi.get(jobId),
    enabled: validId,
    refetchInterval: (q) => (polling && !isFinished(q.state.data) ? POLL_MS : false),
  })
  const job = jobQuery.data
  const phase = job ? phaseOf(job) : null
  const live = !!job && !isFinished(job)
  const videoId = job?.videoId

  const { data: video } = useQuery({
    queryKey: queryKeys.video(videoId ?? 0),
    queryFn: () => videosApi.get(videoId!),
    enabled: !!videoId,
  })

  // ── 실시간 진행률 (SSE) ──
  useEffect(() => {
    if (!live) return
    const controller = new AbortController()
    void subscribeSse(jobsApi.streamPath(jobId), {
      signal: controller.signal,
      onMessage: ({ event, data }) => {
        const msg = parseEvent(event, data)
        if (!msg) return
        queryClient.setQueryData<Job>(queryKeys.job(jobId), (old) =>
          old ? mergeEvent(old, msg) : old,
        )
        // 끝 이벤트에는 걸린 시간(finishedAt) 등이 없으므로 전체 상태를 한 번 더 받는다
        if (msg.event !== 'progress') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.job(jobId) })
        }
      },
      onClose: (reason) => {
        if (controller.signal.aborted) return
        // 정상 종료면 마지막 상태(걸린 시간 등)를 한 번 더 받는다. 끊겼으면 GET 으로 바꿔 따라간다
        void queryClient.invalidateQueries({ queryKey: queryKeys.job(jobId) })
        if (reason !== 'done') setPolling(true)
      },
    })
    return () => controller.abort()
  }, [live, jobId, queryClient])

  // 끝나면 내 영상 목록·영상 정보가 바뀌므로 새로 받게 한다
  useEffect(() => {
    if (phase !== 'done' && phase !== 'failed') return
    void queryClient.invalidateQueries({ queryKey: ['me', 'videos'] })
    if (videoId) void queryClient.invalidateQueries({ queryKey: queryKeys.video(videoId) })
  }, [phase, videoId, queryClient])

  // ── 화면 진입: 탭 제목 + 제목으로 포커스 (대화상자가 떠 있으면 그대로 둔다) ──
  const ready = !!job
  useEffect(() => {
    document.title = '해설 만들기 – AudiSay'
    if (!ready) return
    if (!document.querySelector('dialog[open]')) headingRef.current?.focus({ preventScroll: true })
  }, [ready])

  // ── 읽어 주기: 진행 중엔 단계·10% 단위로, 상태가 바뀌면 한 번 ──
  useProgressAnnounce(phase === 'running' ? (job?.currentStage ?? null) : null, job?.progress ?? 0)
  const retryable =
    !!job?.errorCode && (job.retryable ?? JOB_ERROR_MESSAGES[job.errorCode].retryable)
  useEffect(() => {
    if (phase === 'waiting') announce('해설 만들기 차례를 기다리고 있어요. 곧 시작해요.')
    if (phase === 'done') announce('해설이 준비됐어요. 지금 보기 버튼에 있어요.')
    if (phase === 'failed') {
      announce(
        retryable
          ? '해설을 만들지 못했어요. 다시 요청 버튼에 있어요.'
          : '해설을 만들지 못했어요. 홈으로 가기 버튼에 있어요.',
        { politeness: 'assertive' },
      )
    }
  }, [phase, retryable, announce])

  const retry = useMutation({
    mutationFn: () => videosApi.retry(job!.videoId),
    onSuccess: (r) => {
      setPolling(false)
      navigate(`/jobs/${r.jobId}`, { replace: true })
    },
    onError: (e) => announce(toUserMessage(e), { politeness: 'assertive' }),
  })

  if (!validId || jobQuery.isError) {
    return (
      <div className="max-w-[60rem]">
        <p className="text-2xl font-bold text-navy">해설 만들기</p>
        <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-[2.75rem] font-bold outline-none">
          작업을 찾을 수 없어요
        </h1>
        <p role="alert" className="mt-6 text-2xl">
          {validId ? toUserMessage(jobQuery.error) : '주소가 올바르지 않아요.'}
        </p>
        <ButtonLink to="/" variant="primary" size="hero" className="mt-10 w-full">
          홈으로 가기
        </ButtonLink>
      </div>
    )
  }
  if (!job) return <p className="text-2xl">불러오는 중이에요.</p>

  const progress = phase === 'done' ? 100 : Math.round(job.progress)
  const statusLine =
    phase === 'done'
      ? elapsedText(job)
      : phase === 'failed'
        ? job.currentStage
          ? `${STAGE_NAME[job.currentStage]} 중에 멈췄어요`
          : '시작하기 전에 멈췄어요'
        : remainingText(job)
  const valueText =
    phase === 'running' && job.currentStage
      ? `${progress}퍼센트, ${STAGE_NAME[job.currentStage]} 중, ${remainingText(job)}`
      : `${progress}퍼센트, ${statusLine}`

  return (
    <div className="max-w-[60rem]">
      <p className="text-2xl font-bold text-navy">해설 만들기</p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-[2.75rem] font-bold outline-none">
        {phase === 'done'
          ? '해설을 다 만들었어요'
          : phase === 'failed'
            ? '해설을 만들지 못했어요'
            : '해설을 만들고 있어요'}
      </h1>
      {video && (
        <p className="mt-6 text-2xl">
          {video.title} · {formatDurationSpoken(video.durationSec)}
        </p>
      )}
      <p aria-hidden="true" className="mt-8 text-[8rem] leading-none font-bold tracking-tight">
        {progress}%
      </p>
      <ProgressBar
        value={progress}
        label="해설 만들기 진행률"
        valueText={valueText}
        className="mt-12 h-8"
      />
      <p className="mt-10 text-2xl text-ink-muted">{statusLine}</p>
      <p className="mt-10 text-[1.625rem] font-bold">
        {phase === 'done'
          ? '내 영상에서 언제든 다시 볼 수 있어요.'
          : '다른 화면으로 가도 계속 만들어요. 다 되면 알려 드릴게요.'}
      </p>
      {phase === 'done' && laterChosen && (
        <ButtonLink
          to={`/watch/${job.videoId}`}
          variant="accent"
          size="hero"
          className="mt-8 w-full"
        >
          지금 보기
        </ButtonLink>
      )}
      <ButtonLink to="/" variant="primary" size="hero" className="mt-8 w-full">
        홈으로 가기
      </ButtonLink>

      <StatusDialog
        open={phase === 'done' && !laterChosen}
        kicker="해설 준비 완료"
        tone="success"
        title="해설이 준비됐어요."
        primaryLabel="지금 보기"
        onPrimary={() => navigate(`/watch/${job.videoId}`)}
        secondaryLabel="나중에 보기"
        onSecondary={() => {
          setLaterChosen(true)
          announce('나중에 보기로 했어요. 화면 아래 지금 보기 버튼으로 언제든 볼 수 있어요.')
        }}
      >
        <p className="-mt-4 text-[2.25rem] leading-snug font-bold">지금 볼까요?</p>
        {job.status === 'PARTIAL' && job.coveredUntilMs != null && (
          <p>영상 앞 {formatDurationSpoken(job.coveredUntilMs / 1000)}까지만 해설을 만들었어요.</p>
        )}
      </StatusDialog>

      <StatusDialog
        open={phase === 'failed'}
        kicker="만들기 실패"
        tone="danger"
        title="해설을 만들지 못했어요."
        primaryLabel={
          retry.isPending ? '다시 요청하는 중' : retryable ? '다시 요청' : '홈으로 가기'
        }
        onPrimary={() => {
          if (!retryable) navigate('/')
          else if (!retry.isPending) retry.mutate()
        }}
        secondaryLabel={retryable ? '홈으로 가기' : '내 영상 보기'}
        onSecondary={() => navigate(retryable ? '/' : '/me/videos')}
        // 실패 안내는 사용자가 고를 때까지 닫지 않는다 (원칙 8장)
        onEscape={() => undefined}
      >
        <p className="-mt-4 text-[2.25rem] leading-snug font-bold">
          {retryable
            ? '다시 요청해도 오늘 횟수는 줄지 않아요.'
            : job.errorCode
              ? JOB_ERROR_MESSAGES[job.errorCode].message
              : '알 수 없는 오류가 났어요.'}
        </p>
      </StatusDialog>
    </div>
  )
}
