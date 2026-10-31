import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { Tabs } from './Tabs'
import { Pagination } from './Pagination'

function ReportTabs() {
  const [v, setV] = useState<'scene' | 'reports'>('reports')
  return (
    <Tabs
      label="신고 상세"
      value={v}
      onChange={setV}
      items={[
        { value: 'scene', label: '장면', panel: <p>장면 내용</p> },
        { value: 'reports', label: '신고 3', panel: <p>신고 내용</p> },
      ]}
    />
  )
}

test('탭: Tab 은 선택된 탭에만 멈추고 화살표로 옮기면 바로 선택된다', async () => {
  const { container } = render(<ReportTabs />)
  await userEvent.tab()
  expect(screen.getByRole('tab', { name: '신고 3' })).toHaveFocus()
  expect(screen.getByRole('tabpanel', { name: '신고 3' })).toHaveTextContent('신고 내용')

  await userEvent.keyboard('{ArrowRight}') // 마지막에서 → 는 처음으로
  const scene = screen.getByRole('tab', { name: '장면' })
  expect(scene).toHaveFocus()
  expect(scene).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tabpanel', { name: '장면' })).toHaveTextContent('장면 내용')
  expect(await axe(container)).toHaveNoViolations()
})

test('페이지: 범위를 보여 주고 첫 페이지에서 이전은 비활성', async () => {
  const onChange = vi.fn()
  render(
    <Pagination
      page={{ number: 0, size: 4, totalElements: 48, totalPages: 12, first: true, last: false }}
      onChange={onChange}
    />,
  )
  expect(screen.getByText('1–4 / 48개')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '이전 페이지' }))
  expect(onChange).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '다음 페이지' }))
  expect(onChange).toHaveBeenCalledWith(1)
})