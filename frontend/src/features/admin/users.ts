import type { Role } from '@/api/types'

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
