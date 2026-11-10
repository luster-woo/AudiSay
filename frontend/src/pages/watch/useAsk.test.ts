import { expect, test } from 'vitest'
import { answerToOffer, candidateNumber, settingSpoken } from './useAsk'

test.each([
  ['2번', 2],
  ['2', 2],
  ['두 번째', 2],
  ['첫 번째 거', 1],
  ['삼 번으로 가 줘', 3],
  ['1번 장면', 1],
  ['10번', 10],
  ['열 번째요', 10],
])('"%s"는 후보 %i번', (said, n) => {
  expect(candidateNumber(said)).toBe(n)
})

test.each(['네', '이', '두 번째 골 장면으로 가 줘', '2분 뒤로', '골 장면', '0번', '이 장면'])(
  '"%s"는 후보 번호가 아니다',
  (said) => {
    expect(candidateNumber(said)).toBeNull()
  },
)

test.each([
  ['네', 'yes'],
  ['네 들을게요', 'yes'],
  ['응', 'yes'],
  ['들려줘', 'yes'],
  ['아니요', 'no'],
  ['아니 괜찮아요', 'no'],
  ['안 들을래', 'no'],
  ['네 번째 장면으로 가 줘', null],
  ['세 개만 알려 줘', null],
  ['아니 다음 장면으로 넘어가 줘', null],
  ['범인이 누구야', null],
])('"%s"에 대한 "들으시겠어요?" 대답 → %s', (said, expected) => {
  expect(answerToOffer(said)).toBe(expected)
})

test('챗봇이 말하는 설정 이름은 재생 설정 창과 같다', () => {
  expect(settingSpoken('summaryMode', 'ASK')).toBe('보기 전 30초 요약 묻기')
  expect(settingSpoken('soundMix', 'DIALOGUE_AND_NARRATION')).toBe('해설 켜기')
  expect(settingSpoken('narrationMode', 'PAUSE_AFTER')).toBe('해설 방식 멈추고')
  expect(settingSpoken('subtitleReading', 'DIFFERENT_ONLY')).toBe('자막 읽기 다른 것만')
  expect(settingSpoken('detailLevel', '1')).toBe('해설 상세도 1 짧은 해설')
})

test('이동 답은 시각을 말로 쓴다 (1:30 이 아니라 1분 30초)', async () => {
  const { commandReply } = await import('./history')
  expect(commandReply('SEEK_TIME', 90_000)).toBe('1분 30초로 옮겼어요.')
  expect(commandReply('SEEK_TIME', 0)).toBe('처음으로 옮겼어요.')
})
