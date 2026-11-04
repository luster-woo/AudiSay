import { PageNumbers, type PageNumbersProps } from '@/components/ui/PageNumbers'

export type AdminPaginationProps = Omit<PageNumbersProps, 'size'>

/** 관리자 표 아래 가운데 쪽 넘김 (작은 크기). 홈 영상 목록과 같은 부품을 쓴다 */
export function AdminPagination(props: AdminPaginationProps) {
  return <PageNumbers {...props} size="sm" />
}
