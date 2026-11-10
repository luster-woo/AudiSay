/**
 * '띠' 소리를 내기 전에 기다릴 시간. 낭독기가 포커스(말 끝내기 버튼)와 안내 문구를 다 읽은 뒤에
 * 녹음을 시작해야 사용자 말과 낭독기 음성이 겹치지 않고, 스피커일 때 낭독기 소리가 녹음되지 않는다.
 * 웹 페이지는 낭독기가 언제 다 읽었는지 알 수 없어 글자 수로 어림한다 (NVDA 한국어, 조금 느린 속도 기준).
 */
const FOCUS_MS = 1000
const PER_CHAR_MS = 130
const MAX_MS = 6000

export function screenReaderLeadMs(text: string) {
  const chars = text.replace(/\s/g, '').length
  return Math.min(MAX_MS, FOCUS_MS + chars * PER_CHAR_MS)
}

/** 창이 닫히는 등 화면이 바뀐 직후: 낭독기가 새 위치의 랜드마크·이름까지 읽으므로 조금 더 기다린다 */
const SCREEN_CHANGE_MS = 800

export function afterScreenChangeMs(text: string) {
  return screenReaderLeadMs(text) + SCREEN_CHANGE_MS
}

/**
 * '띠' 소리 전 기다림 (홈 음성 검색 · 영상 화면의 말로 질문하기). 위의 어림은 느린 낭독 속도 기준이라 '띠'까지 3~4초가 걸려
 * 너무 늦다는 의견이 있었다. 짧은 안내 한 줄만 읽으면 되므로 보통 속도 기준으로 짧게 어림한다
 */
const BEEP_FOCUS_MS = 400
const BEEP_PER_CHAR_MS = 70
const BEEP_MAX_MS = 2500

export function beepLeadMs(text: string) {
  const chars = text.replace(/\s/g, '').length
  return Math.min(BEEP_MAX_MS, BEEP_FOCUS_MS + chars * BEEP_PER_CHAR_MS)
}
