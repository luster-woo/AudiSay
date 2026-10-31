import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { ConfirmDialog } from './ConfirmDialog'

function SettingsDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>재생 설정</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="재생 설정"
        description="바꾸면 바로 저장돼요."
      >
        <p>내용</p>
      </Dialog>
    </>
  )
}

test('열면 제목·설명으로 읽히고, 닫으면 연 버튼으로 포커스가 돌아온다', async () => {
  render(<SettingsDemo />)
  const opener = screen.getByRole('button', { name: '재생 설정' })
  await userEvent.click(opener)

  const dialog = screen.getByRole('dialog', { name: '재생 설정' })
  expect(dialog).toHaveAccessibleDescription('바꾸면 바로 저장돼요.')

  await userEvent.click(screen.getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
})

test('Esc(cancel 이벤트)로 닫힌다', async () => {
  render(<SettingsDemo />)
  await userEvent.click(screen.getByRole('button', { name: '재생 설정' }))
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('확인창은 alertdialog 이고 처음 포커스는 취소', async () => {
  const onConfirm = vi.fn()
  render(
    <ConfirmDialog
      open
      title="이 영상의 해설을 전부 다시 만들까요?"
      confirmLabel="다시 만들기"
      danger
      onConfirm={onConfirm}
      onCancel={() => {}}
    />,
  )
  expect(
    screen.getByRole('alertdialog', { name: '이 영상의 해설을 전부 다시 만들까요?' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '취소' })).toHaveFocus()
  await userEvent.click(screen.getByRole('button', { name: '다시 만들기' }))
  expect(onConfirm).toHaveBeenCalledOnce()
})