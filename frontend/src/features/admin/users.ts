import { adminApi, type AdminUserListParams } from '@/api/admin'
import type { AdminUser, Role } from '@/api/types'

export const ROLE_LABELS: Record<Role, string> = {
  GENERAL: '일반',
  VISUALLY_IMPAIRED: '시각장애인',
  ADMIN: '관리자',
}

/** 서버 UTC ISO → 한국 시간 "10. 09." (Figma 회원 표: 월·일 두 자리, 연도 생략) */
export function formatJoinedAt(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/**
 * 역할 표시 점 (Figma: 시각장애인 꽉 찬 점, 일반 빈 점). 글자가 함께 있으니 낭독기엔 숨긴다.
 * 관리자는 Figma 에 없어 점 없이 글자만 둔다 (빈 칸으로 글자 줄은 맞춘다)
 */
export const ROLE_MARK: Record<Role, string> = {
  VISUALLY_IMPAIRED: 'size-[0.6rem] rounded-full bg-ink',
  GENERAL: 'size-[0.4667rem] rounded-full border-2 border-ink',
  ADMIN: '',
}

export type UserSort = 'default' | 'newest' | 'oldest' | 'name'

/** 회원 표 정렬. 기본은 서버 순서(명세: 가입 최신순) */
export const USER_SORT_OPTIONS: { value: UserSort; label: string }[] = [
  { value: 'default', label: '기본' },
  { value: 'newest', label: '가입일(최신 순)' },
  { value: 'oldest', label: '가입일(오래된 순)' },
  { value: 'name', label: '이름(가나다순)' },
]

const byJoined = (a: AdminUser, b: AdminUser) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
const nameCollator = new Intl.Collator('ko')

/** 화면에서 정렬한다 (같은 값이면 가입이 빠른 회원 먼저) */
export function sortUsers(list: AdminUser[], sort: UserSort): AdminUser[] {
  if (sort === 'default') return list
  const sorted = [...list]
  if (sort === 'newest') sorted.sort((a, b) => byJoined(b, a))
  else if (sort === 'oldest') sorted.sort(byJoined)
  else sorted.sort((a, b) => nameCollator.compare(a.name, b.name) || byJoined(a, b))
  return sorted
}

/** 서버 최대 쪽 크기 */
const MAX_SIZE = 50

/** 같은 조건의 회원을 모든 쪽에 걸쳐 받는다 (화면 정렬용). 쪽이 너무 많으면 200쪽에서 멈춘다 */
export async function fetchAllUsers(
  params: Omit<AdminUserListParams, 'page' | 'size'>,
): Promise<AdminUser[]> {
  const out: AdminUser[] = []
  for (let page = 0; page < 200; page++) {
    const res = await adminApi.users({ ...params, page, size: MAX_SIZE })
    out.push(...res.content)
    if (res.page.last || res.content.length === 0) break
  }
  return out
}
