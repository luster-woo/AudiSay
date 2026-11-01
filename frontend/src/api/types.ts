/* API 공통 응답 형식 */
export interface ApiResponse<T> {
  statusCode: number
  timestamp: string
  path: string
  message: string
  data: T
  error: { code: string } | null
}

/* 목록 공통 페이지네이션 */
export interface PageInfo {
  number: number
  size: number
  totalElements: number
  totalPages: number
  first: boolean
  last: boolean
}
export interface Paged<T> {
  content: T[]
  page: PageInfo
}

/** 유저 역할 */
export type Role = 'GENERAL' | 'VISUALLY_IMPAIRED' | 'ADMIN'

/** POST /auth/login */
export interface LoginResult {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
  user: AuthUser
}
export interface AuthUser {
  userId: number
  email: string
  name: string
  role: Role
  tutorialCompleted: boolean
}

/** GET /users/me */
export interface Me {
  userId: number
  email: string
  name: string
  role: Role
  verified: boolean
  verifiedAt: string | null
  createdAt: string
}

/** GET/PATCH /users/me/settings */
export interface UserSettings {
  detailLevel: 1 | 2 | 3
  narrationMode: 'AUTO' | 'WITH_VIDEO' | 'PAUSE_AFTER'
  speechRate: number // 0.5 ~ 2.5
  soundMix: 'DIALOGUE_ONLY' | 'DIALOGUE_AND_NARRATION'
  subtitleReading: 'ALL' | 'DIFFERENT_ONLY' | 'OFF'
  originalVolume: number // 0 ~ 100
  voiceCode: string | null
  seekStepSec: 5 | 10 | 30
  summaryMode: 'ASK' | 'ALWAYS' | 'NEVER'
  highContrast: boolean
  fontSizeLevel: 1 | 2 | 3 | 4 | 5
  tutorialCompleted: boolean
}

/** 기본 재생 설정 */
export const DEFAULT_SETTINGS: UserSettings = {
  detailLevel: 2,
  narrationMode: 'AUTO',
  speechRate: 1.0,
  soundMix: 'DIALOGUE_AND_NARRATION',
  subtitleReading: 'DIFFERENT_ONLY',
  originalVolume: 100,
  voiceCode: null,
  seekStepSec: 10,
  summaryMode: 'ASK',
  highContrast: false,
  fontSizeLevel: 3,
  tutorialCompleted: false,
}

/** 영상 카테고리 */
export type VideoCategory =
  | 'EDUCATION' | 'COOKING' | 'GAME' | 'MUSIC' | 'SCIENCE_IT'
  | 'NEWS' | 'ENTERTAINMENT' | 'SPORTS' | 'ETC'

/** GET /videos 목록 항목 */
export interface VideoSummary {
  videoId: number
  sourceType: 'YOUTUBE' | 'UPLOAD'
  title: string
  channelTitle: string
  thumbnailUrl: string | null
  durationSec: number
  category: VideoCategory
  isFavorite: boolean
}

/** 해설 생성 작업 (GET /jobs/{id} 와 SSE 공용) */
export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
export type JobStage = 'PREPARE' | 'DESCRIBE' | 'MERGE' | 'TTS'
export type JobErrorCode =
  | 'VIDEO_UNAVAILABLE' | 'DURATION_MISMATCH' | 'TRANSCODE_FAILED'
  | 'AI_LIMIT' | 'AI_TIMEOUT' | 'UNKNOWN'

export interface Job {
  jobId: number
  videoId: number
  jobType: 'GENERATE' | 'REGENERATE'
  status: JobStatus
  currentStage: JobStage | null
  progress: number
  estimatedRemainingSec: number | null
  descriptionId: number | null
  coveredUntilMs: number | null
  errorCode: JobErrorCode | null
  retryable: boolean | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
}

/** SSE 이벤트 3종 */
export type JobEvent =
  | { event: 'progress'; data: Pick<Job, 'status' | 'currentStage' | 'progress' | 'estimatedRemainingSec'> }
  | { event: 'completed'; data: Pick<Job, 'status' | 'descriptionId' | 'coveredUntilMs'> }
  | { event: 'failed'; data: Pick<Job, 'status' | 'errorCode' | 'retryable'> & { message: string } }

/** POST /auth/signup 의 data */
export interface SignupResult {
  userId: number
  email: string
  name: string
  role: Role
}

/** GET /auth/email/availability 의 data */
export interface EmailAvailability {
  email: string
  available: boolean
}

/** POST /users/me/verification 의 data — 새 역할이 담긴 AccessToken 을 함께 준다 */
export interface VerificationResult {
  role: Role
  verifiedAt: string
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
}
