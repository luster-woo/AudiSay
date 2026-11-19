import type { UserSettings } from '@/api/types'

/**
 * 글자 크기·고대비를 이 브라우저에 기억해 두는 localStorage 키.
 * index.html 의 인라인 스크립트가 같은 키를 읽어 화면을 그리기 전에 <html> 에 칠한다 — 키를 바꾸면 거기도 바꾼다.
 * (설정은 로그인 확인 → /users/me/settings 응답 뒤에야 오므로, 기억해 두지 않으면 기본 크기로 그린 화면이
 *  한 번 더 커지며 통째로 밀린다. 글자 5단계에서 CLS 0.72)
 */
export const DISPLAY_KEY = 'audisay:display'

export type Display = Pick<UserSettings, 'highContrast' | 'fontSizeLevel'>

/** 기억해 둔 값. 없거나 깨졌으면 null (index.html 의 인라인 스크립트와 같은 기준) */
export function readDisplay(): Display | null {
  try {
    const d = JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? 'null') as Partial<Display> | null
    if (!d || ![1, 2, 3, 4, 5].includes(d.fontSizeLevel as number)) return null
    return {
      fontSizeLevel: d.fontSizeLevel as Display['fontSizeLevel'],
      highContrast: d.highContrast === true,
    }
  } catch {
    return null
  }
}

export function saveDisplay({ fontSizeLevel, highContrast }: Display) {
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify({ fontSizeLevel, highContrast }))
  } catch {
    /* 저장소를 막은 브라우저: 다음 접속 때 한 번 밀릴 뿐 지금 화면에는 문제없다 */
  }
}
