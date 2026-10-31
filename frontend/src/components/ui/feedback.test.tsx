import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/renderWithProviders'
import { Stepper } from './Stepper'
import { ProgressBar } from './ProgressBar'
import { Badge } from './Badge'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn().mockRejectedValue(new Error('no cookie')) }
})

function Speed() {
  const [v, setV] = useState(1.0)
  return (
    <Stepper
      label="말하기 속도"
      value={v}
      min={0.5}
      max={2.5}
      step={0.1}
      onChange={setV}
      format={(n) => `${n.toFixed(1)}배`}
    />
  )
}

test('Stepper: 소수점 오차 없이 바뀐다', async () => {
  renderWithProviders(<Speed />)
  const up = await screen.findByRole('button', { name: '말하기 속도 늘리기' })
  await userEvent.click(up)
  await userEvent.click(up)
  await userEvent.click(up)
  expect(screen.getByRole('group', { name: '말하기 속도' })).toHaveTextContent('1.3배')
})

test('ProgressBar: 값과 읽을 문구', () => {
  render(
    <ProgressBar value={50} label="해설 만들기 진행률" valueText="50퍼센트, 약 1분 20초 남음" />,
  )
  const bar = screen.getByRole('progressbar', { name: '해설 만들기 진행률' })
  expect(bar).toHaveAttribute('aria-valuenow', '50')
  expect(bar).toHaveAttribute('aria-valuetext', '50퍼센트, 약 1분 20초 남음')
})

test('Badge: 화면 글자 대신 읽을 문구', () => {
  render(<Badge spoken="신고 3건">신고 3</Badge>)
  expect(screen.getByText('신고 3건')).toHaveClass('sr-only')
})