import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
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
