import type { Dialogue, NarrationLine } from '@/api/types'
import { isDubLine } from './dubLines'

const line = (startMs: number, text: string, detailLevel: 1 | 2 | 3 = 1): NarrationLine => ({
  lineId: startMs,
  lineIndex: 1,
  detailLevel,
  startMs,
  gapEndMs: null,
  importance: 3,
  text,
  audioUrl: null,
  audioDurationMs: null,
})
const dialogues: Dialogue[] = [
  { startMs: 461_000, endMs: 462_000, text: '신사 숙녀 여러분!', characterName: null },
  { startMs: 491_000, endMs: 526_000, text: '총독 각하의 건배사입니다. 금일 쇼와 7년', characterName: null },
]

test('외국어 대사 번역 문장: 상세도 1, "이름: "을 뗀 글이 그 시각 대사 안에 있다 (BE DubLines 와 같은 규칙)', () => {
  expect(isDubLine(line(461_000, '일본 고위 관리: 신사 숙녀 여러분!'), dialogues)).toBe(true)
  expect(isDubLine(line(495_000, '금일 쇼와 7년'), dialogues)).toBe(true) // 긴 연설이 나뉜 뒤쪽 문장
  expect(isDubLine(line(461_000, '신사 숙녀 여러분!', 2), dialogues)).toBe(false) // 해설 상세도
  expect(isDubLine(line(463_000, '훈장을 단 남성이 마이크 앞에 선다.'), dialogues)).toBe(false)
  expect(isDubLine(line(600_000, '신사 숙녀 여러분!'), dialogues)).toBe(false) // 대사 끝 + 15초 지남
})
