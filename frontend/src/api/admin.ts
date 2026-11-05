import { request } from './client'
import type {
  AdminReport,
  AiUsageStats,
  ChatStats,
  AdminUser,
  LineAudioResult,
  LineUpdateResult,
  Paged,
  RegenerateResult,
  ReportHandleResult,
  ReportReason,
  ReportStatus,
  ReviewDescription,
  Role,
} from './types'

export interface AdminReportListParams {
  /** 없으면 서버 기본값 PENDING */
  status?: ReportStatus
  reason?: ReportReason
  videoId?: number
  page?: number
  size?: number
}

export interface ReviewDescriptionParams {
  /** 없으면 공개 해설, 공개 해설이 없으면 가장 최근 버전 */
  descriptionId?: number
  /** 처리 전 신고가 있는 문장만 */
  reportedOnly?: boolean
}

export interface AdminUserListParams {
  /** 없으면 전체 역할 */
  role?: Role
  /** 이메일 또는 이름 일부 */
  keyword?: string
  /** 기본 false (탈퇴 회원 제외) */
  includeWithdrawn?: boolean
  page?: number
  /** 기본 20, 최대 50 */
  size?: number
}

/** 관리자 API. ADMIN 역할만 호출할 수 있다 (아니면 403 COMMON_003) */
export const adminApi = {
  /** 신고 목록 (오래된 순) */
  reports: (params: AdminReportListParams) =>
    request<Paged<AdminReport>>({ url: '/admin/reports', params }),
  /** 신고를 처리 완료·반려로 바꾼다. 이미 처리된 신고면 409 REPORT_003 */
  handleReport: (
    reportId: number,
    status: Exclude<ReportStatus, 'PENDING'>,
    applyToSameLine = false,
  ) =>
    request<ReportHandleResult>({
      method: 'PATCH',
      url: `/admin/reports/${reportId}`,
      data: { status, applyToSameLine },
    }),
  /** 장면 설명·대사·화면 글자·신고 수와 함께 해설 문장을 본다 */
  reviewDescription: (videoId: number, params: ReviewDescriptionParams = {}) =>
    request<ReviewDescription>({ url: `/admin/videos/${videoId}/description`, params }),
  /** 문장을 고치면 음성도 다시 만든다 (1~500자) */
  updateLine: (lineId: number, body: { text: string; importance?: 1 | 2 | 3 }) =>
    request<LineUpdateResult>({ method: 'PATCH', url: `/admin/lines/${lineId}`, data: body }),
  /** 문장은 그대로 두고 음성만 다시 만든다 */
  regenerateLineAudio: (lineId: number) =>
    request<LineAudioResult>({ method: 'POST', url: `/admin/lines/${lineId}/audio`, data: {} }),
  /** 영상 해설 전체를 다시 만든다. 이미 만드는 중이면 409 JOB_002 */
  regenerate: (videoId: number) =>
    request<RegenerateResult>({ method: 'POST', url: `/admin/videos/${videoId}/regenerate` }),
  /** 회원 목록 (가입 최신순). 보기만 하고 바꾸는 API 는 없다 */
  users: (params: AdminUserListParams) =>
    request<Paged<AdminUser>>({ url: '/admin/users', params }),
  /** 기간(KST 날짜, 양끝 포함, 최대 92일) 안의 AI 호출·토큰·크레딧 통계 */
  aiUsage: (from: string, to: string) =>
    request<AiUsageStats>({ url: '/admin/stats/ai-usage', params: { from, to } }),
  /** 기간(KST 날짜, 양끝 포함, 최대 92일) 안의 챗봇 입력·답변 품질 통계 */
  chatStats: (from: string, to: string) =>
    request<ChatStats>({ url: '/admin/stats/chat', params: { from, to } }),
}
