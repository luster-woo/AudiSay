import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { Button } from './Button'
import { TextField } from './TextField'
import { PasswordField } from './PasswordField'
import { Checkbox } from './Checkbox'
import { ChoiceGroup } from './ChoiceGroup'
import { Select } from './Select'

describe('Button', () => {
  test('비활성이어도 Tab 으로 갈 수 있고, 눌러도 아무 일도 없다', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        저장
      </Button>,
    )
    const btn = screen.getByRole('button', { name: '저장' })
    await userEvent.tab()
    expect(btn).toHaveFocus()
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  test('loading 이면 aria-busy', () => {
    render(<Button loading>보내는 중</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  })
})

describe('TextField', () => {
  test('이름·안내·오류가 연결되어 읽힌다', async () => {
    const { container } = render(
      <TextField label="이메일" hint="예: haneul@example.com" error="이메일 형식이 아니에요." />,
    )
    const input = screen.getByRole('textbox', { name: '이메일' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('예: haneul@example.com 이메일 형식이 아니에요.')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('PasswordField', () => {
  test('보기 버튼으로 글자를 보이고, 버튼 이름이 숨기기로 바뀐다', async () => {
    render(<PasswordField label="비밀번호" />)
    const input = screen.getByLabelText('비밀번호')
    expect(input).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 보기' }))
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: '비밀번호 숨기기' })).not.toHaveAttribute('aria-pressed')
  })
})

describe('Checkbox', () => {
  test('indeterminate 를 DOM 에 반영한다', () => {
    render(<Checkbox label="전체 선택" indeterminate readOnly />)
    const box = screen.getByRole('checkbox', { name: '전체 선택' }) as HTMLInputElement
    expect(box.indeterminate).toBe(true)
  })
})

describe('ChoiceGroup', () => {
  function Detail() {
    const [v, setV] = useState<1 | 2 | 3>(2)
    return (
      <ChoiceGroup
        legend="해설 상세도"
        value={v}
        onChange={setV}
        options={[
          { value: 1, label: '1 짧게' },
          { value: 2, label: '2 기본' },
          { value: 3, label: '3 자세히' },
        ]}
      />
    )
  }

  test('라디오 묶음으로 읽히고 화살표로 바뀐다', async () => {
    const { container } = render(<Detail />)
    expect(screen.getByRole('group', { name: '해설 상세도' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '2 기본' })).toBeChecked()

    await userEvent.tab()
    expect(screen.getByRole('radio', { name: '2 기본' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: '3 자세히' })).toBeChecked()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Select', () => {
  test('이름으로 찾을 수 있다', () => {
    render(
      <Select
        label="카테고리"
        options={[
          { value: '', label: '전체' },
          { value: 'COOKING', label: '요리' },
        ]}
      />,
    )
    expect(screen.getByRole('combobox', { name: '카테고리' })).toHaveValue('')
  })
})