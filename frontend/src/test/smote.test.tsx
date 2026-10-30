import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import App from '@/App'

test('앱이 렌더되고 접근성 위반이 없다', async () => {
  const { container } = render(<App />)
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(await axe(container)).toHaveNoViolations()
})
