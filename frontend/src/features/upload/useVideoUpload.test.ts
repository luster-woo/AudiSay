import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { uploadsApi } from '@/api/uploads'
import { useVideoUpload } from './useVideoUpload'
import { uploadParts } from './uploadParts'

vi.mock('@/api/uploads', () => ({
  uploadsApi: { start: vi.fn(), complete: vi.fn(), abort: vi.fn(), abortOnUnload: vi.fn() },
}))
vi.mock('./uploadParts', () => ({ uploadParts: vi.fn() }))

/* 탭 사이 잠금(Web Locks) 흉내: 이름별로 쥔 쪽이 있으면 ifAvailable 요청은 null 을 받는다 */
const held = new Set<string>()
const fakeLocks = {
  request: async (name: string, a: unknown, b?: unknown) => {
    const opts = (typeof a === 'function' ? {} : a) as { ifAvailable?: boolean }
    const cb = (typeof a === 'function' ? a : b) as (lock: unknown) => unknown
    if (held.has(name)) {
      if (opts.ifAvailable) return cb(null)
      throw new Error('이 흉내는 기다리기를 하지 않는다')
    }
    held.add(name)
    try {
      return await cb({ name })
    } finally {
      held.delete(name)
    }
  },
}

const draft = {
  file: new File(['x'], 'a.mp4', { type: 'video/mp4' }),
  durationSec: 10,
  title: '제목',
  visibility: 'PRIVATE' as const,
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...navigator, locks: fakeLocks })
  vi.mocked(uploadsApi.start).mockResolvedValue({ videoId: 30, partSizeBytes: 1, partCount: 1 })
  vi.mocked(uploadsApi.abort).mockResolvedValue(null)
  vi.mocked(uploadParts).mockReturnValue(new Promise(() => {})) // 올리는 중으로 둔다
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  held.clear()
  localStorage.clear()
})

test('다른 탭이 지금 올리는 업로드는 지우지 않고, 버려진 업로드만 정리한다', async () => {
  // 10번은 다른 탭이 올리는 중(잠금을 쥐고 있음), 11번은 탭을 닫아 버려진 업로드
  localStorage.setItem('audisay:pending-upload', JSON.stringify([10, 11]))
  held.add('audisay:upload:10')
  const { result } = renderHook(() => useVideoUpload(() => {}))
  await act(() => result.current.begin(draft))
  expect(uploadsApi.abort).toHaveBeenCalledTimes(1)
  expect(uploadsApi.abort).toHaveBeenCalledWith(11)
  // 다른 탭 것은 남고, 이 탭이 새로 올리는 30번이 더해진다. 30번 잠금은 이 탭이 쥔다
  expect(JSON.parse(localStorage.getItem('audisay:pending-upload')!)).toEqual([10, 30])
  expect(held.has('audisay:upload:30')).toBe(true)
})

test('예전 형식(번호 하나)으로 적힌 버려진 업로드도 정리하고, 멈추면 잠금을 푼다', async () => {
  localStorage.setItem('audisay:pending-upload', '7')
  const { result } = renderHook(() => useVideoUpload(() => {}))
  await act(() => result.current.begin(draft))
  expect(uploadsApi.abort).toHaveBeenCalledWith(7)
  await act(() => result.current.stop())
  expect(uploadsApi.abort).toHaveBeenLastCalledWith(30)
  expect(localStorage.getItem('audisay:pending-upload')).toBeNull()
  expect(held.has('audisay:upload:30')).toBe(false)
})
