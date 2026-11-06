import { describe, expect, test } from 'vitest'
import { BOUNCE_SEC, countdownAt, nextAnchor } from './useRemainingCountdown'

describe('남은 시간 1초씩 세기', () => {
  test('받은 값에서 1초마다 1씩 줄고 0에서 멈춘다', () => {
    const a = nextAnchor(null, 37, 0)
    expect(countdownAt(a, 0)).toBe(37)
    expect(countdownAt(a, 1_000)).toBe(36)
    expect(countdownAt(a, 15_000)).toBe(22)
    expect(countdownAt(a, 60_000)).toBe(0)
  })

  test('새 값이 조금 많으면 되올리지 않고 이어서 센다', () => {
    const a = nextAnchor(null, 37, 0)
    // 15초 뒤 화면 22, 서버 24 → 22에서 계속
    const b = nextAnchor(a, 24, 15_000)
    expect(b).toBe(a)
    expect(countdownAt(b, 16_000)).toBe(21)
  })

  test('새 값이 적거나 많이 많으면 새 값으로 맞춘다', () => {
    const a = nextAnchor(null, 37, 0)
    expect(countdownAt(nextAnchor(a, 10, 15_000), 15_000)).toBe(10)
    expect(countdownAt(nextAnchor(a, 22 + BOUNCE_SEC + 1, 15_000), 15_000)).toBe(28)
  })

  test('서버가 모른다(null)고 하면 null', () => {
    expect(countdownAt(nextAnchor(nextAnchor(null, 30, 0), null, 5_000), 5_000)).toBeNull()
  })
})
