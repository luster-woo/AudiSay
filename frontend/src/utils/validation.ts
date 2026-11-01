/** 이메일 형식 (서버도 다시 검사한다) */
export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/** 비밀번호 규칙: 8~20자, 영문·숫자·특수문자 모두 포함 (API 명세 회원가입) */
export function isValidPassword(value: string) {
  return (
    value.length >= 8 &&
    value.length <= 20 &&
    /[A-Za-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  )
}

/** 1234567 → "1.2MB" */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
