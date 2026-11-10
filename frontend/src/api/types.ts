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
  seekStepSec: 10,
  summaryMode: 'ASK',
  highContrast: false,
  fontSizeLevel: 3,
  tutorialCompleted: false,
}

/** 영상 카테고리 */
export type VideoCategory =
  | 'EDUCATION'
  | 'COOKING'
  | 'GAME'
  | 'MUSIC'
  | 'SCIENCE_IT'
  | 'NEWS'
  | 'ENTERTAINMENT'
  | 'SPORTS'
  | 'ETC'

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
  | 'VIDEO_UNAVAILABLE'
  | 'DURATION_MISMATCH'
  | 'TRANSCODE_FAILED'
  | 'AI_LIMIT'
  | 'AI_TIMEOUT'
  | 'UNKNOWN'

export interface Job {
  jobId: number
  videoId: number
  jobType: 'GENERATE' | 'REGENERATE'
  status: JobStatus
  currentStage: JobStage | null
  progress: number
  estimatedRemainingSec: number | null
  /** 서버 예상 전체 시간(지난 시간 + 남은 시간). 진행 막대를 남은 시간과 같은 예측으로 그린다 */
  estimatedTotalSec: number | null
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
  | {
      event: 'progress'
      data: Pick<
        Job,
        'status' | 'currentStage' | 'progress' | 'estimatedRemainingSec' | 'estimatedTotalSec'
      >
    }
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
  /** 지워졌거나 비공개라 찾지 못한 영상(rejectReason NOT_FOUND)이면 제목·채널·길이가 없다 */
  title: string | null
  channelTitle: string | null
  thumbnailUrl: string | null
  durationSec: number | null
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

/** GET /favorites — 볼 수 없는 영상도 해제할 수 있도록 목록에 남는다 */
export interface FavoriteVideo {
  videoId: number
  sourceType: 'YOUTUBE' | 'UPLOAD'
  title: string
  thumbnailUrl: string | null
  durationSec: number
  category: VideoCategory | null
  hasDescription: boolean
  available: boolean
  favoritedAt: string
}

/** PATCH /videos/{id}/visibility */
export interface VisibilityResult {
  videoId: number
  visibility: Visibility
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
  /** 이 문장을 읽을 수 있는 빈 구간의 끝. 빈 구간이 없으면 null (영상을 잠깐 멈추고 읽는다) */
  gapEndMs: number | null
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
  /** 문장 글자가 바뀌어 음성을 다시 만드는 중이면 true. 중요도만 바꿨으면 false(음성 그대로) */
  audioRegenerating: boolean
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

/** BE ChatIntent 와 같다. RECAP = 지금까지 줄거리, SEARCH_VIDEO = 다른 영상 찾기 */
export type ChatIntent =
  | 'QUESTION'
  | 'SCENE_NOW'
  | 'SEEK_TIME'
  | 'SEEK_SCENE'
  | 'SETTING'
  | 'ACTION'
  | 'SEARCH_VIDEO'
  | 'RECAP'
  | 'UNKNOWN'

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
  | 'REPLAY_TUTORIAL'
  /** 방금 읽은 해설·답변 다시 */
  | 'REPEAT_LAST'
  /** 이동하기 전 위치로 되돌리기 */
  | 'UNDO_SEEK'
  /** 읽는 소리만 멈춤 (영상은 그대로) */
  | 'STOP_SPEAKING'

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
  | { intent: 'QUESTION' | 'SCENE_NOW' | 'RECAP'; result: { answerStreamUrl: string } }
  | { intent: 'SEEK_TIME'; result: { targetMs: number } }
  | {
      intent: 'SEEK_SCENE'
      result: {
        targetMs: number | null
        chapterId: number | null
        candidates: SceneCandidate[]
        /** 후보가 없을 때 읽어 줄 말 ("못 찾았어요" / "시간이 오래 걸려요" 등) */
        message?: string | null
      }
    }
  | {
      intent: 'SETTING'
      result: {
        settingKey: keyof UserSettings
        settingValue: string
        /** 범위 끝에 닿았을 때 읽어 줄 말 ("가장 빠른 속도예요.", 이미 끝이면 "이미 가장 빠른 속도예요.") */
        message?: string | null
      }
    }
  | { intent: 'ACTION'; result: { actionCode: ChatActionCode } }
  /** 영상 밖(홈)에서만 query 가 온다. 영상 안에서는 query 없이 안내 message 만 */
  | { intent: 'SEARCH_VIDEO'; result: { query: string | null; message?: string | null } }
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
        /**
         * 질문한 시각까지 자료로는 답하지 못했지만 그 뒤 내용에 답이 있다. 답변 끝에 "들으시겠어요?"를 묻는다.
         * 사용자가 그러겠다고 하면 같은 chatLogId 를 includeFuture=true 로 한 번 더 구독한다.
         */
        futureAvailable?: boolean
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
  /** 답변 intent 인데 null 이면 답을 끝까지 받지 못한 것 (실패·취소). answerText 는 받은 데까지 */
  answerSource?: 'STORED' | 'UNANSWERABLE' | 'FUTURE' | null
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

/* ───────────── 관리자 · AI 사용량 통계 ───────────── */

/** 호출 묶음 공통 집계 */
export interface AiUsageTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  /** 모델 단가표 × 토큰으로 조회 시점에 계산. H200 호출은 0 */
  estimatedCredits: number
}

export interface AiUsageByPurpose extends AiUsageTotals {
  /** DESCRIBE, QUESTION, INTENT, STT, TTS, VERIFY … */
  purpose: string
  errorRate: number
  p50LatencyMs: number | null
  p95LatencyMs: number | null
}

export interface AiUsageByModel extends AiUsageTotals {
  model: string
}

export interface AiUsageDaily extends AiUsageTotals {
  /** YYYY-MM-DD (KST) */
  date: string
}

/** GET /admin/stats/ai-usage 의 data */
export interface AiUsageStats {
  from: string
  to: string
  summary: AiUsageTotals & {
    /** error_code 가 있는 호출 비율 (0 ~ 1) */
    errorRate: number
    /** 대체 응답(is_fallback) 비율 (0 ~ 1) */
    fallbackRate: number
  }
  /** 크레딧 큰 순 */
  byPurpose: AiUsageByPurpose[]
  /** 크레딧 큰 순 */
  byModel: AiUsageByModel[]
  /** 날짜 순. 호출이 없는 날도 0 으로 온다 */
  daily: AiUsageDaily[]
  /** 유튜브 해설 재사용으로 아낀 크레딧 */
  reuse: {
    newJob: number
    reused: number
    joinedJob: number
    avgCreditsPerVideo: number
    savedCredits: number
    /** savedCredits ÷ (savedCredits + 실제 생성 크레딧) */
    savedRate: number
  }
}

/* ───────────── 관리자 · 챗봇 품질 통계 ───────────── */

/** chat_logs.intent */
export type ChatIntentCode =
  | 'QUESTION'
  | 'SCENE_NOW'
  | 'SEEK_SCENE'
  | 'SEEK_TIME'
  | 'SETTING'
  | 'ACTION'
  | 'SEARCH_VIDEO'
  | 'RECAP'
  | 'UNKNOWN'

export interface ChatIntentStat {
  intent: ChatIntentCode | string
  count: number
  /** 분류 시간. 규칙으로 분류하면 거의 0 */
  intentP50Ms: number | null
  intentP95Ms: number | null
}

export interface ChatAnswerIntentStat {
  /** QUESTION · SCENE_NOW · RECAP 중 기록이 있는 것 */
  intent: ChatIntentCode | string
  answered: number
  /** 바로 답함 */
  stored: number
  /** 자료에 없음 */
  unanswerable: number
  /** 뒤에 있는 답을 골라 들음 */
  future: number
  firstAudioP50Ms: number | null
  firstAudioP95Ms: number | null
}

/** GET /admin/stats/chat 의 data. 비율은 0 ~ 1(분모가 0이면 0), 시간은 ms */
export interface ChatStats {
  from: string
  to: string
  inputs: number
  /** 입력 많은 순 */
  byIntent: ChatIntentStat[]
  answer: {
    byIntent: ChatAnswerIntentStat[]
    /** 끝까지 간 질문(QUESTION) 답변 수 */
    questions: number
    /** 질문한 시각까지 자료로 바로 답하지 못한 질문 (UNANSWERABLE + FUTURE) */
    notAnsweredDirectly: number
    /** 그중 뒤에 답이 있어 "들으시겠어요?"를 물은 수 */
    futureOffered: number
    /** 그중 사용자가 듣기로 한 수 */
    futureChosen: number
    unanswerableRate: number
    futureOfferedRate: number
    futureChosenRate: number
  }
  seek: {
    total: number
    keyword: number
    /** 임베딩 검색(RAG)으로 찾음. BE가 아직 주지 않을 수 있다 */
    rag?: number
    llm: number
    notFound: number
    keywordRate: number
  }
  /** 어디에도 답이 없던 질문 최근 20개 */
  recentUnanswered: {
    chatLogId: number
    videoId: number | null
    videoTitle: string | null
    videoTimeMs: number | null
    utterance: string
    /** KST YYYY-MM-DD HH:mm */
    createdAt: string
  }[]
}
