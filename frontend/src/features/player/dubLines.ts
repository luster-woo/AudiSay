import type { Dialogue, NarrationLine } from '@/api/types'

/** 번역 문장이 대사 끝보다 이만큼 늦게 시작해도 그 대사의 번역으로 본다 (긴 번역이 뒤로 밀림. BE DubLines 와 같다) */
const AFTER_END_MS = 15_000
const SPEAKER = /^[^:\s][^:]{0,29}:\s+/
const compact = (s: string) => s.replace(/\s+/g, '')

/**
 * 외국어 대사를 한국어로 읽어 주는 문장인가. AI 가 유튜브 외국어 대사의 번역을 대사 시각에 상세도 1 문장
 * ("태웅: 금일 5월 15일.")으로 넣는데, 해설과 가르는 표시가 아직 API 에 없어 BE(DubLines)와 같은 규칙으로 가른다:
 * 상세도 1이고, 앞의 "이름: "을 뗀 글이(공백 무시) 그 시각에 걸친 대사 글 안에 그대로 있다.
 * (대사 dialogues 에는 같은 번역이 대사 글로 들어 있다)
 */
export function isDubLine(line: NarrationLine, dialogues: readonly Dialogue[]): boolean {
  if (line.detailLevel !== 1 || !line.text) return false
  const body = compact(line.text.trim().replace(SPEAKER, ''))
  if (body.length < 2) return false
  return dialogues.some(
    (d) =>
      d.startMs <= line.startMs &&
      line.startMs <= d.endMs + AFTER_END_MS &&
      compact(d.text ?? '').includes(body),
  )
}
