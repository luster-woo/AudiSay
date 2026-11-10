/** 이메일 형식 (서버도 다시 검사한다) */
export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/**
 * 비밀번호 규칙: 서버(PasswordPolicy.REGEX)와 똑같이 맞춘다.
 * 8~20자, 영문·숫자·특수문자(공백 제외)를 각각 하나 이상, 공백 없음
 */
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s])\S{8,20}$/
/** 화면 안내 문구 (힌트·오류 공통) */
export const PASSWORD_RULE = '8~20자, 영문·숫자·특수문자를 모두 넣고 띄어쓰기는 빼요.'

export function isValidPassword(value: string) {
  return PASSWORD_REGEX.test(value)
}

/** 1234567 → "1.2MB" */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
