import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import analyzingImg from '@/assets/job/odi-analyzing.webp'
import analyzingStillImg from '@/assets/job/odi-analyzing-still.webp'
import { JobMascot } from './JobMascot'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

test('멈춤 여부를 기억해 두고 다시 열면 그대로 보여 준다', async () => {
  const user = userEvent.setup()
  const { unmount } = render(<JobMascot phase="running" />)
  await user.click(screen.getByRole('button', { name: '캐릭터 움직임 멈추기' }))
  expect(screen.getByRole('button', { name: '캐릭터 움직임 켜기' })).toBeInTheDocument()
  unmount()
  render(<JobMascot phase="running" />)
  expect(screen.getByRole('button', { name: '캐릭터 움직임 켜기' })).toBeInTheDocument()
})

test('저장소를 막아 둔 브라우저에서도 화면이 깨지지 않고 멈춤 버튼이 동작한다', async () => {
  const user = userEvent.setup()
  const blocked = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
  render(<JobMascot phase="running" />)
  await user.click(screen.getByRole('button', { name: '캐릭터 움직임 멈추기' }))
  expect(screen.getByRole('button', { name: '캐릭터 움직임 켜기' })).toBeInTheDocument()
})

/** new Image() 로 미리 받는 것을 가로채, 받기 끝난 때를 테스트가 정한다 */
function captureImages() {
  const made: { src: string; onload: (() => void) | null }[] = []
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      onload: (() => void) | null = null
      constructor() {
        made.push(this)
      }
    },
  )
  return made
}

test('움직이는 그림은 화면이 뜬 뒤에 받고, 받기 전에는 멈춘 그림을 보여 준다', async () => {
  vi.useFakeTimers()
  const made = captureImages()
  render(<JobMascot phase="running" />)
  const img = () =>
    screen.getByRole('button', { name: '캐릭터 움직임 멈추기' }).querySelector('img')!
  expect(img()).toHaveAttribute('src', analyzingStillImg)
  expect(made).toHaveLength(0) // 처음 그릴 때는 받지 않는다

  await act(() => vi.advanceTimersByTimeAsync(600))
  expect(made.map((m) => m.src)).toEqual([analyzingImg])
  act(() => made[0].onload?.())
  expect(img()).toHaveAttribute('src', analyzingImg)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('멈춰 둔 상태면 움직이는 그림을 받지 않는다', async () => {
  vi.useFakeTimers()
  localStorage.setItem('jobMascotPaused', '1')
  const made = captureImages()
  render(<JobMascot phase="running" />)
  await act(() => vi.advanceTimersByTimeAsync(3000))
  expect(made).toHaveLength(0)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
