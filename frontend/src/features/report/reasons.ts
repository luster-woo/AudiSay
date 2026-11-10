import type { ReportReason } from '@/api/types'

/**
 * 신고 사유 이름. 사용자 신고 창과 관리자 신고 처리 화면이 같은 이름을 쓴다 (사용자 화면 이름 기준, 2026-11-10 점검).
 * 회원 문의·운영 기록에서 같은 사유를 다른 이름으로 부르지 않게 한 곳에 둔다
 */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  WRONG: '틀린 내용',
  MISSING: '중요한 내용 빠짐',
  OVERLAP: '대사와 겹침',
  OTHER: '기타 (직접 입력)',
}
