import type { Job, JobStage } from '@/api/types'

export type SourceType = 'YOUTUBE' | 'UPLOAD'

/** 화면에 보여 줄 단계. 업로드 영상만 '영상 업로드'가 앞에 붙는다 */
export type StepKey = 'UPLOAD' | JobStage

/** 미완료 / 진행 중 / 완료 / 멈춤(실패) */
export type StepState = 'pending' | 'active' | 'done' | 'failed'

export interface Step {
  key: StepKey
  label: string
  state: StepState
}

/** 업로드 영상의 전체 진행률에서 '영상 업로드'가 차지하는 몫 (나머지는 해설 만들기) */
export const UPLOAD_WEIGHT = 0.15

export const JOB_STAGES: readonly JobStage[] = ['PREPARE', 'DESCRIBE', 'MERGE', 'TTS']

export const STEP_LABEL: Record<StepKey, string> = {
  UPLOAD: '영상 업로드',
  PREPARE: '영상 분석',
  DESCRIBE: '장면 해설 만들기',
  MERGE: '해설 합치고 다듬기',
  TTS: '해설 음성 만들기',
}

export function stepKeys(source: SourceType): StepKey[] {
  return source === 'UPLOAD' ? ['UPLOAD', ...JOB_STAGES] : [...JOB_STAGES]
}

const clamp = (n: number) => Math.min(100, Math.max(0, n))

/** 올리는 중의 전체 진행률 (0 ~ 15) */
export function uploadOverallPercent(uploadPercent: number): number {
  return Math.floor(clamp(uploadPercent) * UPLOAD_WEIGHT)
}

/**
 * 해설 만들기 중의 전체 진행률.
 * jobProgress 는 해설 만들기 전체의 화면 진행률(0~100, toDisplayProgress 로 바꾼 값)이다.
 * 업로드 영상은 업로드 몫(15) 뒤에 이어 붙인다. 내림으로 계산해 끝나기 전에 100 이 보이지 않게 한다.
 */
export function jobOverallPercent(source: SourceType, jobProgress: number): number {
  const p = clamp(jobProgress)
  if (source === 'YOUTUBE') return Math.floor(p)
  return Math.floor(UPLOAD_WEIGHT * 100 + p * (1 - UPLOAD_WEIGHT))
}

/**
 * 서버 progress 는 단계마다 고정 구간(PREPARE 0~20, DESCRIBE 20~70, MERGE 70~80, TTS 80~100)이라
 * 실제 걸리는 시간과 맞지 않는다. 영상 분석(PREPARE)이 대부분의 시간을 쓰고, 장면 해설·합치기는 AI 를 부르지 않아
 * 몇 초면 끝난다(2026-11-04 실측: 5초 업로드 영상 PREPARE 약 8초 → DESCRIBE·MERGE 1초 안 → TTS 약 5초).
 * 그래서 화면에서는 걸리는 시간에 맞춘 구간으로 다시 나눠 보여 준다.
 */
const SERVER_RANGE: Record<JobStage, readonly [number, number]> = {
  PREPARE: [0, 20],
  DESCRIBE: [20, 70],
  MERGE: [70, 80],
  TTS: [80, 100],
}
const DISPLAY_RANGE: Record<JobStage, readonly [number, number]> = {
  PREPARE: [0, 75],
  DESCRIBE: [75, 80],
  MERGE: [80, 83],
  TTS: [83, 100],
}

const stageOfServer = (p: number): JobStage =>
  JOB_STAGES.find((st) => p < SERVER_RANGE[st][1]) ?? 'TTS'

/** 서버 진행률(0~100) → 화면 진행률(0~100). 단계 구간 안에서는 비율을 그대로 옮긴다 */
export function toDisplayProgress(serverProgress: number): number {
  const p = clamp(serverProgress)
  if (p >= 100) return 100
  const st = stageOfServer(p)
  const [s0, s1] = SERVER_RANGE[st]
  const [d0, d1] = DISPLAY_RANGE[st]
  return d0 + ((p - s0) / (s1 - s0)) * (d1 - d0)
}

/**
 * 단계 하나가 걸릴 것으로 보는 시간(초). 서버는 단계 안의 진행률을 거의 보내지 않으므로(SSE 는 10% 단위,
 * 유튜브 분석은 Gemini 한 번 호출) 이 시간에 맞춰 화면 막대를 조금씩 채운다.
 * 업로드 분석은 영상 길이의 약 1.4배(local.py 주석, H200), 유튜브는 약 0.15배(prepare.py 주석).
 */
export function expectedStageSec(source: SourceType, stage: JobStage, durationSec: number): number {
  const d = Math.max(1, durationSec)
  switch (stage) {
    case 'PREPARE':
      return source === 'UPLOAD' ? Math.max(10, d * 1.4) : Math.max(20, d * 0.15)
    case 'TTS':
      return Math.max(5, d * 0.1)
    default:
      return 3
  }
}

/** 단계 구간 안에서 예상 시간만큼 지났으면 구간의 95%까지 채운다. 서버 값보다 작아지지 않는다 */
export function estimateDisplayProgress(
  stage: JobStage,
  serverProgress: number,
  elapsedSec: number,
  expectedSec: number,
): number {
  const fromServer = toDisplayProgress(serverProgress)
  const [d0, d1] = DISPLAY_RANGE[stage]
  const ratio = Math.min(0.95, Math.max(0, elapsedSec) / Math.max(1, expectedSec))
  return Math.max(fromServer, d0 + (d1 - d0) * ratio)
}

/** 올리는 중의 단계 상태: 업로드만 진행 중(또는 멈춤), 해설 만들기 4단계는 미완료 */
export function uploadSteps(uploadState: 'active' | 'done' | 'failed'): Step[] {
  return stepKeys('UPLOAD').map((key) => ({
    key,
    label: STEP_LABEL[key],
    state: key === 'UPLOAD' ? uploadState : 'pending',
  }))
}

/**
 * 작업 상태로 단계 상태를 계산한다. 서버 단계는 PREPARE → DESCRIBE → MERGE → TTS 순서로만 바뀌므로
 * 현재 단계 앞은 완료, 현재 단계는 진행 중(실패면 멈춤), 뒤는 미완료다.
 * 업로드 영상의 '영상 업로드'는 작업이 생긴 시점에 이미 끝났으므로 늘 완료다.
 */
export function jobSteps(source: SourceType, job: Pick<Job, 'status' | 'currentStage'>): Step[] {
  const finished = job.status === 'SUCCEEDED' || job.status === 'PARTIAL'
  // 실패했는데 단계가 없으면 첫 단계에서 멈춘 것으로 본다
  const current =
    job.currentStage != null
      ? JOB_STAGES.indexOf(job.currentStage)
      : job.status === 'FAILED'
        ? 0
        : -1
  const stageState = (i: number): StepState => {
    if (finished) return 'done'
    if (job.status === 'QUEUED' || current < 0) return 'pending'
    if (i < current) return 'done'
    if (i > current) return 'pending'
    return job.status === 'FAILED' ? 'failed' : 'active'
  }
  return stepKeys(source).map((key) => ({
    key,
    label: STEP_LABEL[key],
    state: key === 'UPLOAD' ? 'done' : stageState(JOB_STAGES.indexOf(key)),
  }))
}
