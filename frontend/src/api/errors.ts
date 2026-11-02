import type { JobErrorCode } from './types'

/** 서버가 준 에러 봉투를 담는 예외. 호출부는 err.code 로 분기한다 */
export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** 네트워크 끊김·타임아웃처럼 서버 응답이 없는 경우 */
export class NetworkError extends Error {
  constructor() {
    super('서버와 연결할 수 없어요. 인터넷 연결을 확인해 주세요.')
    this.name = 'NetworkError'
  }
}

/** 명세 에러 코드 → 사용자에게 읽어 줄 쉬운말 문구 */
export const ERROR_MESSAGES: Record<string, string> = {
  COMMON_001: '입력한 값을 다시 확인해 주세요.',
  COMMON_002: '로그인이 필요해요.',
  COMMON_003: '권한이 없어요.',
  COMMON_004: '잠시 문제가 생겼어요. 조금 뒤에 다시 시도해 주세요.',
  COMMON_005: '없는 주소예요.',
  COMMON_006: '지원하지 않는 요청이에요.',
  AUTH_001: '이메일 또는 비밀번호가 맞지 않아요.',
  AUTH_002: '로그인이 만료됐어요. 다시 로그인해 주세요.',
  AUTH_003: '로그인을 다시 확인하는 중이에요.',
  USER_001: '이미 사용 중인 이메일이에요.',
  USER_002: '비밀번호가 맞지 않아요.',
  USER_003: '이미 인증된 회원이에요.',
  USER_004: '민감정보 처리에 동의해야 인증할 수 있어요.',
  USER_005: '없는 회원이에요.',
  VIDEO_001: '유튜브 주소 형식이 아니에요.',
  VIDEO_002: '비공개이거나 삭제된 영상이에요.',
  VIDEO_003: '다른 사이트에서 재생을 막은 영상이에요.',
  VIDEO_004: '영상이 너무 길어요.',
  VIDEO_005: '연령 제한이나 실시간 방송 영상은 지원하지 않아요.',
  VIDEO_006: '없는 영상이에요.',
  VIDEO_007: '비공개 영상이에요.',
  VIDEO_008: '지금은 검색을 쓸 수 없어요. 유튜브 주소를 붙여 넣어 주세요.',
  UPLOAD_001: 'MP4, MOV, WebM 파일만 올릴 수 있어요.',
  UPLOAD_002: '파일이 너무 커요. 해상도를 낮춰서 올려 주세요.',
  UPLOAD_003: '저작권 동의가 필요해요.',
  UPLOAD_004: '이미 끝났거나 중단된 업로드예요.',
  UPLOAD_005: '올라간 조각 정보가 맞지 않아요.',
  UPLOAD_006: '아직 재생용 파일을 만드는 중이에요.',
  LIMIT_001: '오늘 이용 횟수를 다 썼어요.',
  LIMIT_002: '이 영상은 오늘 더 다시 요청할 수 없어요.',
  JOB_001: '없는 작업이에요.',
  JOB_002: '이미 해설을 만드는 중이에요.',
  JOB_003: '지금은 다시 요청할 수 없어요.',
  DESC_001: '없는 해설이에요.',
  DESC_002: '이 구간은 해설이 없어요.',
  DESC_003: '없는 해설 문장이에요.',
  CHAT_001: '말을 알아듣지 못했어요. 다시 말씀해 주세요.',
  CHAT_002: '음성 파일 형식이나 길이가 맞지 않아요.',
  CHAT_003: '답변이 필요한 입력이 아니에요.',
  CHAT_004: '없는 질문 기록이에요.',
  REPORT_001: '이미 신고한 문장이에요.',
  REPORT_002: '없는 신고예요.',
  REPORT_003: '이미 처리된 신고예요.',
}

/** 작업 실패 원인 코드 */
export const JOB_ERROR_MESSAGES: Record<JobErrorCode, { message: string; retryable: boolean }> = {
  VIDEO_UNAVAILABLE: { message: '영상이 비공개로 바뀌어 해설을 만들 수 없어요.', retryable: false },
  DURATION_MISMATCH: { message: '영상 길이가 올릴 때와 달라요.', retryable: false },
  TRANSCODE_FAILED: { message: '영상 파일을 읽을 수 없어요.', retryable: false },
  AI_LIMIT: { message: '지금 요청이 많아요. 잠시 뒤에 다시 시도해 주세요.', retryable: true },
  AI_TIMEOUT: { message: '시간이 오래 걸려 멈췄어요. 다시 시도해 주세요.', retryable: true },
  UNKNOWN: { message: '알 수 없는 오류가 났어요.', retryable: true },
}

export function toUserMessage(err: unknown): string {
  if (err instanceof ApiError) return ERROR_MESSAGES[err.code] ?? err.message
  if (err instanceof NetworkError) return err.message
  return ERROR_MESSAGES.COMMON_004
}
