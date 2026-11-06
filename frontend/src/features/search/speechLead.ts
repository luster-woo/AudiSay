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
