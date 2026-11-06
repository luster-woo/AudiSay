/**
 * 낱말 뒤에 '으로'/'로'를 붙인다. 받침이 있으면 '으로', 없거나 ㄹ 받침이면 '로'("2분으로", "21초로", "해설로").
 * 숫자로 끝나면 읽는 소리로 정한다("1:20으로", "1:24로")
 */
export function withRo(word: string): string {
  const last = word.trimEnd().slice(-1)
  if (/\d/.test(last)) return word + ('036'.includes(last) ? '으로' : '로')
  const code = last.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return word + '로'
  const jong = code % 28
  return word + (jong === 0 || jong === 8 ? '로' : '으로')
}
