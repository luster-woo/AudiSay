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

/** GET /videos/{id} — 영상 정보와 해설 상태 */
export interface VideoDetail extends VideoSummary {
  youtubeVideoId: string | null
  visibility: Visibility
  status: 'REGISTERED' | 'UPLOADING' | 'UNAVAILABLE'
  isOwner: boolean
  /** 지금 공개 중인 해설. null 이면 아직 없음 */
  descriptionId: number | null
  /** 만드는 중인 작업. 다시 만드는 중이면 descriptionId 와 함께 온다 */
  activeJobId: number | null
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

/** 영상의 해설 상태 (유튜브 사전 확인·내 영상 목록 공용) */
export type DescriptionStatus = 'NONE' | 'GENERATING' | 'READY' | 'FAILED'

/** GET /videos/youtube/search 항목. 해설 있는 영상이 앞에 온다 */
export interface YoutubeSearchItem {
  youtubeVideoId: string
  title: string
  channelTitle: string
  thumbnailUrl: string | null
  durationSec: number
  hasDescription: boolean
  /** 우리 서비스에 등록된 영상이면 ID, 아니면 null */
  videoId: number | null
}

export interface YoutubeSearchResult {
  items: YoutubeSearchItem[]
  nextPageToken: string | null
}

export type YoutubeRejectReason =
  'NOT_FOUND' | 'PRIVATE' | 'NOT_EMBEDDABLE' | 'TOO_LONG' | 'AGE_RESTRICTED' | 'LIVE'

/** POST /videos/youtube/check — 확인만 하고 횟수는 쓰지 않는다 */
export interface YoutubeCheck {
  youtubeVideoId: string
  title: string
  channelTitle: string
  thumbnailUrl: string | null
  durationSec: number
  available: boolean
  rejectReason: YoutubeRejectReason | null
  videoId: number | null
  descriptionStatus: DescriptionStatus
  /** 해설을 요청하면 오늘 횟수가 줄어드는지 */
  willCount: boolean
}

/** POST /videos/youtube — 해설 요청 결과 */
export interface YoutubeRequestResult {
  videoId: number
  result: 'REUSED' | 'JOINED_JOB' | 'NEW_JOB'
  jobId: number | null
  descriptionId: number | null
  counted: boolean
  remaining: number | null
}

/** POST /videos/{id}/retry */
export interface RetryResult {
  videoId: number
  jobId: number
  result: 'NEW_JOB'
  counted: false
  retryRemainingToday: number
}

/** GET /users/me/quota — 관리자는 limit·remaining 이 null */
export interface QuotaItem {
  maxDurationSec: number | null
  limit: number | null
  used: number
  remaining: number | null
}
export interface Quota {
  role: Role
  date: string
  youtube: QuotaItem
  upload: QuotaItem & { maxSizeBytes: number | null }
}

/** GET /users/me/videos 항목 */
export interface MyVideo {
  videoId: number
  sourceType: 'YOUTUBE' | 'UPLOAD'
  title: string
  thumbnailUrl: string | null
  durationSec: number
  category: VideoCategory | null
  available: boolean
  descriptionStatus: DescriptionStatus
  jobId: number | null
  requestedAt: string
}

/** POST·DELETE /favorites/{videoId} */
export interface FavoriteResult {
  videoId: number
  isFavorite: boolean
}

/** GET /admin/users 항목 (가입 최신순) */
export interface AdminUser {
  userId: number
  email: string
  name: string
  role: Role
  /** 시각장애인 인증일. 인증 안 했으면 null */
  verifiedAt: string | null
  /** 탈퇴일. includeWithdrawn=true 일 때만 값이 있을 수 있다 */
  withdrawnAt: string | null
  createdAt: string
}

/** 신고 처리 상태 · 사유 */
export type ReportStatus = 'PENDING' | 'RESOLVED' | 'REJECTED'
export type ReportReason = 'WRONG' | 'MISSING' | 'OVERLAP' | 'OTHER'

/** GET /admin/reports 항목. 신고 당시 문장과 지금 문장을 함께 준다 */
export interface AdminReport {
  reportId: number
  status: ReportStatus
  reason: ReportReason
  reasonDetail: string | null
  videoId: number
  videoTitle: string
  descriptionId: number
  lineId: number
  detailLevel: 1 | 2 | 3
  lineStartMs: number
  reportedAtMs: number
  lineTextSnapshot: string
  currentText: string
  /** 같은 문장에 들어온 신고 수 (이 신고 포함) */
  sameLineReportCount: number
  reporterId: number
  createdAt: string
  handledAt: string | null
}

/** PATCH /admin/reports/{reportId} */
export interface ReportHandleResult {
  reportId: number
  status: Exclude<ReportStatus, 'PENDING'>
  handledAt: string
  /** applyToSameLine 이면 같은 문장의 다른 신고 ID 도 들어온다 */
  updatedReportIds: number[]
}

/** 해설 버전 상태 */
export type DescriptionVersionStatus = 'GENERATING' | 'PUBLISHED' | 'FAILED' | 'ARCHIVED'

/** GET /admin/videos/{videoId}/description — 검수용 해설 (장면·문장·대사·화면 글자) */
export interface ReviewDescription {
  descriptionId: number
  videoId: number
  status: DescriptionVersionStatus
  versions: { descriptionId: number; status: DescriptionVersionStatus; createdAt: string }[]
  scenes: ReviewScene[]
  lines: ReviewLine[]
  dialogues: ReviewDialogue[]
  screenTexts: ReviewScreenText[]
}
export interface ReviewScene {
  sceneId: number
  sceneIndex: number
  title: string
  startMs: number
  endMs: number
  sceneDescription: string
  /** 대표 프레임. 유튜브 영상은 null */
  keyframeUrl: string | null
}
export interface ReviewLine {
  lineId: number
  lineIndex: number
  detailLevel: 1 | 2 | 3
  startMs: number
  /** 이 문장을 읽을 수 있는 빈 구간의 끝 */
  gapEndMs: number
  importance: 1 | 2 | 3
  text: string
  /** 음성을 다시 만드는 중이거나 실패하면 null */
  audioUrl: string | null
  audioDurationMs: number | null
  reportCount: number
  pendingReportCount: number
  updatedAt: string
}
export interface ReviewDialogue {
  startMs: number
  endMs: number
  text: string
  characterName: string | null
}
export interface ReviewScreenText {
  screenTextId: number
  startMs: number
  endMs: number
  textType: string
  importance: string
  headline: string | null
  fullText: string
  summaryText: string | null
  sameAsDialogue: boolean
}

/** PATCH /admin/lines/{lineId} */
export interface LineUpdateResult {
  lineId: number
  descriptionId: number
  detailLevel: 1 | 2 | 3
  startMs: number
  importance: 1 | 2 | 3
  text: string
  audioUrl: string | null
  updatedAt: string
}

/** POST /admin/lines/{lineId}/audio (202) */
export interface LineAudioResult {
  lineId: number
  queued: boolean
}

/** POST /admin/videos/{videoId}/regenerate (202) */
export interface RegenerateResult {
  videoId: number
  jobId: number
  jobType: 'REGENERATE'
  currentDescriptionId: number | null
}

/** 영상 공개 범위 */
export type Visibility = 'PRIVATE' | 'PUBLIC'

/** POST /uploads 의 body */
export interface UploadStartBody {
  title: string
  originalFilename: string
  contentType: 'video/mp4' | 'video/quicktime' | 'video/webm'
  sizeBytes: number
  durationSec: number
  visibility: Visibility
  copyrightAgreed: true
}

/** POST /uploads 의 data — 조각 크기와 개수는 서버가 정한다 */
export interface UploadStartResult {
  videoId: number
  partSizeBytes: number
  partCount: number
}

/** POST /uploads/{id}/parts 의 data */
export interface UploadPartUrls {
  parts: { partNumber: number; url: string }[]
  expiresAt: string
}

/** POST /uploads/{id}/complete 의 data */
export interface UploadCompleteResult {
  videoId: number
  jobId: number
  result: 'NEW_JOB'
  remaining: number | null
}
