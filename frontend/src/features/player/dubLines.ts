import type { Dialogue, NarrationLine } from '@/api/types'

/** 번역 문장이 대사 끝보다 이만큼 늦게 시작해도 그 대사의 번역으로 본다 (긴 번역이 뒤로 밀림. BE DubLines 와 같다) */
const AFTER_END_MS = 15_000
const SPEAKER = /^[^:\s][^:]{0,29}:\s+/
const compact = (s: string) => s.replace(/\s+/g, '')

/** 이 번역 문장의 원래 대사(그 시각에 걸쳐 있고 번역 글을 담은 대사). 없으면 null */
function sourceDialogue(line: NarrationLine, dialogues: readonly Dialogue[]): Dialogue | null {
  if (line.detailLevel !== 1 || !line.text) return null
  const body = compact(line.text.trim().replace(SPEAKER, ''))
  if (body.length < 2) return null
  return (
    dialogues.find(
      (d) =>
        d.startMs <= line.startMs &&
        line.startMs <= d.endMs + AFTER_END_MS &&
        compact(d.text ?? '').includes(body),
    ) ?? null
  )
}

/**
 * 외국어 대사를 한국어로 읽어 주는 문장인가. AI 가 유튜브 외국어 대사의 번역을 대사 시각에 상세도 1 문장
 * ("태웅: 금일 5월 15일.")으로 넣고 종류(lineType)를 DIALOGUE 로 적는다.
 * 종류 칸이 생기기 전 해설은 모두 NARRATION 이라 BE(DubLines)와 같은 규칙으로 한 번 더 가른다:
 * 상세도 1이고, 앞의 "이름: "을 뗀 글이(공백 무시) 그 시각에 걸친 대사 글 안에 그대로 있다.
 */
export function isDubLine(line: NarrationLine, dialogues: readonly Dialogue[]): boolean {
  return line.lineType === 'DIALOGUE' || sourceDialogue(line, dialogues) !== null
}

/**
 * 번역 문장을 영상 위에 겹쳐 읽을 수 있는 끝 시각: 원래 대사가 끝나는 시각.
 * 원래 대사를 못 찾으면 빈 구간 끝(gapEndMs), 그것도 없으면 null (겹쳐 읽을 틈 없음)
 */
export function dubEndMs(line: NarrationLine, dialogues: readonly Dialogue[]): number | null {
  return sourceDialogue(line, dialogues)?.endMs ?? line.gapEndMs
}
