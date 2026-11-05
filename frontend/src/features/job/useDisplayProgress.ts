import { useEffect, useState } from 'react'
import type { Job, JobStage } from '@/api/types'
import {
  estimateDisplayProgress,
  expectedStageSec,
  jobOverallPercent,
  toDisplayProgress,
  type SourceType,
} from './stages'

const TICK_MS = 1_000

/**
 * 해설 만들기 화면에 보일 전체 진행률(0~100, 정수).
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

  if (!source || !job) return 0
  if (job.status === 'SUCCEEDED' || job.status === 'PARTIAL') return 100
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
