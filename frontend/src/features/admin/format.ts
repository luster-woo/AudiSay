/**
 * 관리자 표의 날짜 표기를 하나로 맞춘다 (2026-11-10 점검: 회원 '10. 09.', 신고 '10. 9. 09:12', 통계 '2026-10-05',
 * 챗봇 통계 '11-04 14:00'처럼 화면마다 달랐다). 모두 한국 시각, 'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm'
 */
const parts = (iso: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> => {
  const p: Record<string, string> = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  )
  // 자정이 '24'로 나오는 환경이 있다
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    minute: p.minute,
    hour: p.hour === '24' ? '00' : p.hour,
  }
}

/** "2026-10-09" */
export function formatAdminDate(iso: string): string {
  const p = parts(iso)
  return `${p.year}-${p.month}-${p.day}`
}

/** "2026-10-09 09:12" */
export function formatAdminDateTime(iso: string): string {
  const p = parts(iso)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}
