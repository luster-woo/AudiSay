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

/** 서버 문구가 비어 있을 때(응답 형식이 깨졌을 때 등)만 쓰는 문구 */
const FALLBACK_MESSAGE = '잠시 문제가 생겼어요. 조금 뒤에 다시 시도해 주세요.'

/**
 * 작업 실패 원인 코드 → 다시 요청할 수 있는지 (서버 Job.isRetryable 과 같다).
 * 실패 문구는 서버가 준다 (작업 조회의 errorMessage, SSE failed 의 message). 여기 따로 두지 않는다
 */
const JOB_RETRYABLE: Record<JobErrorCode, boolean> = {
  VIDEO_UNAVAILABLE: false,
  DURATION_MISMATCH: false,
  TRANSCODE_FAILED: false,
  AI_LIMIT: true,
  AI_TIMEOUT: true,
  UNKNOWN: true,
}
const JOB_FALLBACK_MESSAGE = '알 수 없는 오류가 났어요.'

/** 작업 실패 → 문구·다시 요청 가능 여부. 문구는 서버 것(message)을 쓰고, 없으면 기본 문구 (화면이 깨지지 않게) */
export function jobError(code: string | null | undefined, message?: string | null) {
  return {
    message: message || JOB_FALLBACK_MESSAGE,
    retryable: JOB_RETRYABLE[(code ?? 'UNKNOWN') as JobErrorCode] ?? true,
  }
}

/**
 * 사용자에게 읽어 줄 문구. 서버 오류 문구(ErrorCode, 앱 말투 '~해요')를 하나의 기준으로 삼아 그대로 쓴다.
 * (2026-11-10 점검: 같은 뜻의 문구를 프론트에도 따로 두어 서버 '~습니다'와 섞이거나 서로 달랐다)
 */
export function toUserMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message || FALLBACK_MESSAGE
  if (err instanceof NetworkError) return err.message
  return FALLBACK_MESSAGE
}
