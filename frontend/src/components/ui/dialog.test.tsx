import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
test('브라우저가 창을 강제로 닫으면(close 이벤트) 닫지 않는 창은 다시 띄우고, 닫는 창은 부모 상태도 닫힌다', async () => {
  const stay = vi.fn()
  const { unmount } = render(
    <Dialog open onClose={stay} title="업로드가 끊겼어요" hideCloseButton>
      <p>내용</p>
    </Dialog>,
  )
  const el = screen.getByRole('dialog', { name: '업로드가 끊겼어요' }) as HTMLDialogElement
  el.close() // 크롬 CloseWatcher 가 강제로 닫은 것과 같다
  expect(stay).toHaveBeenCalled()
  expect(el.open).toBe(true)
  unmount()

  render(<SettingsDemo />)
  await userEvent.click(screen.getByRole('button', { name: '재생 설정' }))
  act(() => (screen.getByRole('dialog') as HTMLDialogElement).close())
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: '재생 설정' })).toHaveFocus()
})
