import { useEffect, useState } from 'react'
import type { Job, JobStage } from '@/api/types'
import {
  estimateDisplayProgress,
  expectedStageSec,
  jobOverallPercent,
  timeProgress,
  toDisplayProgress,
  type SourceType,
} from './stages'

const TICK_MS = 1_000

/**
 * 해설 만들기 화면에 보일 전체 진행률(0~100, 정수).
 * 서버가 예상 전체 시간을 주면 남은 시간과 같은 예측으로 그린다(timeProgress) — 막대와 남은 시간이 어긋나지 않게.
 * 서버 예상이 늘어 값이 줄면 이 작업에서 보인 가장 큰 값을 유지한다(막대·읽어 주기가 뒤로 가지 않게).
 * 서버 예상이 없을 때만 아래 예전 방식:
 * - 서버 진행률을 걸리는 시간에 맞춘 구간으로 바꾸고(toDisplayProgress)
 * - 단계 안에서는 예상 시간에 맞춰 1초마다 조금씩 채우며(estimateDisplayProgress, 구간의 95%까지)
 * - 업로드 영상은 업로드 몫 15% 뒤에 잇는다(jobOverallPercent).
 * 영상 분석 단계의 경과 시간은 서버 startedAt 기준이라 화면을 다시 열어도 이어진다.
 * 다른 단계는 이 화면에서 그 단계를 처음 본 시각부터 센다.
 */
export function useDisplayProgress(
  source: SourceType | undefined,
  job: Job | undefined,
  durationSec: number | undefined,
  /** 화면에서 1초씩 센 남은 시간(useRemainingCountdown). 없으면 서버 값 */
  remainingSec?: number | null,
): number {
  const stage = job?.status === 'RUNNING' ? (job.currentStage ?? null) : null
  const [now, setNow] = useState(() => Date.now())
  const [seen, setSeen] = useState<{ stage: JobStage; at: number } | null>(null)

  useEffect(() => {
    if (!stage) return
    const id = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      // 단계가 바뀐 뒤 첫 틱에 그 단계의 시작 시각을 남긴다 (그 전까지는 경과 0초로 본다)
      setSeen((prev) => (prev?.stage === stage ? prev : { stage, at: t }))
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [stage])

  const [peak, setPeak] = useState<{ jobId: number; value: number } | null>(null)

  if (!source || !job) return 0
  if (job.status === 'SUCCEEDED' || job.status === 'PARTIAL') return 100
  const byTime =
    job.status === 'RUNNING'
      ? timeProgress(
          job.estimatedTotalSec,
          remainingSec === undefined ? job.estimatedRemainingSec : remainingSec,
        )
      : null
  if (byTime != null) {
    const value = jobOverallPercent(source, byTime)
    const shown = peak?.jobId === job.jobId ? Math.max(peak.value, value) : value
    // 렌더 중 상태 맞추기(이전 렌더 값 기억). 값이 같으면 다시 부르지 않는다
    if (peak?.jobId !== job.jobId || peak.value !== shown)
      setPeak({ jobId: job.jobId, value: shown })
    return shown
  }
  if (!stage) return jobOverallPercent(source, toDisplayProgress(job.progress))

  const startedAt =
    stage === 'PREPARE' && job.startedAt
      ? Date.parse(job.startedAt)
      : seen?.stage === stage
        ? seen.at
        : now
  const display = estimateDisplayProgress(
    stage,
    job.progress,
    (now - startedAt) / 1000,
    expectedStageSec(source, stage, durationSec ?? 60),
  )
  return jobOverallPercent(source, display)
}
