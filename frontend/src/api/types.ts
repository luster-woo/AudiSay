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

/* ───────────── 시청 화면 ───────────── */

/** GET /videos/{id}/playback 의 data */
export interface Playback {
  sourceType: 'UPLOAD' | 'YOUTUBE'
  /** 업로드 영상: 1시간 유효한 S3 주소 */
  playbackUrl: string | null
  playbackFormat: 'MP4' | null
  expiresAt: string | null
  /** 유튜브 영상: IFrame 플레이어에 넣을 ID */
  youtubeVideoId: string | null
}

/** 해설 문장 한 줄. 상세도별로 같은 lineIndex 가 여러 줄 온다 */
export interface NarrationLine {
  lineId: number
  lineIndex: number
  detailLevel: 1 | 2 | 3
  startMs: number
  /** 이 문장 뒤 다음 대사가 시작되기 전까지의 빈 구간 끝. 없으면 null */
  gapEndMs: number | null
  /** 1(낮음) ~ 3(높음). 시간이 모자라면 높은 것부터 남긴다 */
  importance: number
  text: string
  /** S3 주소(6시간 유효). null 이면 브라우저 음성으로 읽는다 */
  audioUrl: string | null
  audioDurationMs: number | null
}

export interface Scene {
  sceneId: number
  sceneIndex: number
  title: string
  startMs: number
  endMs: number
}

export interface Dialogue {
  startMs: number
  endMs: number
  text: string
  characterName: string | null
}

export type ScreenTextImportance = 'HIGH' | 'MEDIUM' | 'LOW'
export interface ScreenText {
  screenTextId: number
  startMs: number
  endMs: number
  textType: string
  importance: ScreenTextImportance
  headline: string | null
  fullText: string
  summaryText: string | null
  sameAsDialogue: boolean
}

/** GET /videos/{id}/description 의 data — 재생에 필요한 해설 전체 */
export interface Description {
  descriptionId: number
  videoId: number
  status: 'PUBLISHED'
  /** 일부 구간만 해설이 있으면 그 끝. 전부 있으면 null */
  coveredUntilMs: number | null
  createdAt: string
  lines: NarrationLine[]
  scenes: Scene[]
  dialogues: Dialogue[]
  screenTexts: ScreenText[]
}

export interface Chapter {
  chapterId: number
  chapterIndex: number
  title: string
  startMs: number
  endMs: number
  summary: string
}

/** GET /videos/{id}/chapters 의 data */
export interface Chapters {
  descriptionId: number
  chapters: Chapter[]
}

/** GET /videos/{id}/summary 의 data */
export interface VideoSummary30 {
  descriptionId: number
  summary: { text: string; audioUrl: string | null; durationMs: number | null }
  /** 대사가 많아 요약을 먼저 듣는 게 좋은 영상 */
  recommendSummary: boolean
}

/** GET /videos/{id}/scenes/at 의 data */
export interface SceneAt {
  sceneId: number
  title: string
  startMs: number
  endMs: number
  sceneDescription: string
}

/* ───────────── 챗봇 ───────────── */

export type ChatIntent =
  'QUESTION' | 'SCENE_NOW' | 'SEEK_TIME' | 'SEEK_SCENE' | 'SETTING' | 'ACTION' | 'UNKNOWN'

export type ChatActionCode =
  | 'PLAY'
  | 'PAUSE'
  | 'CURRENT_POSITION'
  | 'NEXT_SCENE'
  | 'PREV_SCENE'
  | 'PLAY_SUMMARY'
  | 'READ_DETAIL'
  | 'HELP'
  | 'OPEN_CHAPTERS'
  | 'OPEN_SCRIPT'
  | 'OPEN_HISTORY'
  | 'FAVORITE_ADD'
  | 'FAVORITE_REMOVE'
  | 'REPORT'
  | 'REPLAY_TUTORIAL'

export interface SceneCandidate {
  chapterId: number
  title: string
  startMs: number
  summary: string
}

/** POST /chat/messages 의 body */
export interface ChatMessageBody {
  videoId: number | null
  descriptionId: number | null
  videoTimeMs: number | null
  utterance: string
  inputMode: 'TEXT' | 'VOICE'
}

/** POST /chat/messages 의 data — intent 에 따라 result 모양이 다르다 */
export type ChatMessageResult = {
  chatLogId: number
  inputMode: 'TEXT' | 'VOICE'
  utterance: string
} & (
  | { intent: 'QUESTION' | 'SCENE_NOW'; result: { answerStreamUrl: string } }
  | { intent: 'SEEK_TIME'; result: { targetMs: number } }
  | {
      intent: 'SEEK_SCENE'
      result: { targetMs: number | null; chapterId: number | null; candidates: SceneCandidate[] }
    }
  | { intent: 'SETTING'; result: { settingKey: keyof UserSettings; settingValue: string } }
  | { intent: 'ACTION'; result: { actionCode: ChatActionCode } }
  | { intent: 'UNKNOWN'; result: { message: string } }
)

/** GET /chat/messages/{id}/stream 의 SSE 이벤트 */
export type ChatStreamEvent =
  | { event: 'delta'; data: { text: string } }
  | { event: 'sentence'; data: { text: string; audioUrl: string | null } }
  | {
      event: 'done'
      data: {
        answerText: string
        answerSource: 'STORED' | 'UNANSWERABLE' | string
        firstAudioMs: number | null
        totalLatencyMs: number | null
      }
    }
  | { event: 'error'; data: { errorCode: string; message: string } }

/** GET /videos/{id}/chat/messages 의 기록 한 건 */
export interface ChatHistoryItem {
  chatLogId: number
  inputMode: 'TEXT' | 'VOICE'
  utterance: string
  intent: ChatIntent
  videoTimeMs: number | null
  targetMs: number | null
  answerText: string | null
  createdAt: string
}

export interface ChatHistory {
  messages: ChatHistoryItem[]
  nextCursor: number | null
  hasNext: boolean
}

/* ───────────── 신고 ───────────── */

/** 신고 사유(ReportReason)는 위 관리자 신고 타입과 같은 것을 쓴다 */
export interface ReportBody {
  reportedAtMs: number
  reason: ReportReason
  reasonDetail?: string
}

export interface ReportResult {
  reportId: number
  status: 'PENDING'
}
