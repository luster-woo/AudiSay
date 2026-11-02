import { request } from './client'
import type {
  AdminReport,
  LineAudioResult,
  LineUpdateResult,
  Paged,
  RegenerateResult,
  ReportHandleResult,
  ReportReason,
  ReportStatus,
  ReviewDescription,
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
}
