import { request } from './client'
import type { ReportBody, ReportResult } from './types'

/** 해설 문장 신고. 같은 문장은 한 번만 (REPORT_001) */
export const reportsApi = {
  create: (lineId: number, body: ReportBody) =>
    request<ReportResult>({ method: 'POST', url: `/lines/${lineId}/reports`, data: body }),
}
