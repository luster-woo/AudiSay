import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { queryKeys } from '@/api/queryKeys'

const PARAMS = { status: 'PENDING', size: 1 } as const

/** 처리 전 신고 수 (사이드바·상태 탭 숫자). 목록 한 건만 받아 totalElements 를 쓴다 */
export function usePendingReportCount() {
  const { data } = useQuery({
    queryKey: queryKeys.admin.reports(PARAMS),
    queryFn: () => adminApi.reports(PARAMS),
  })
  return data?.page.totalElements
}
