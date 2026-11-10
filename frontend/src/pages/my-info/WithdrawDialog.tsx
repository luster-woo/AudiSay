import { useRef, useState, type FormEvent } from 'react'
import { usersApi } from '@/api/users'
import { ApiError, toUserMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { PasswordField } from '@/components/ui/PasswordField'
import { useAnnouncer } from '@/features/announcer/context'
import { useAuth } from '@/features/auth/context'

export function WithdrawDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { announce } = useAnnouncer()
  const { endSession } = useAuth()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [failure, setFailure] = useState('')
  const [pending, setPending] = useState(false)

  const close = () => {
    if (busyRef.current) return
    setPassword('')
    setError('')
    setFailure('')
    onClose()
  }

  const inputError = (message: string) => {
    setError(message)
    requestAnimationFrame(() => {
      passwordRef.current?.focus()
      announce(`탈퇴하지 못했어요. ${message}`, { politeness: 'assertive' })
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busyRef.current) return
    if (!password) return inputError('확인을 위해 비밀번호를 입력해 주세요.')
    busyRef.current = true
    setPending(true)
    setError('')
    setFailure('')
    try {
      await usersApi.withdraw(password)
      await endSession('회원 탈퇴가 완료됐어요.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'USER_002') {
        setPassword('')
        inputError('비밀번호가 맞지 않아요. 다시 입력해 주세요.')
      } else {
        const message = toUserMessage(err)
        setFailure(message)
        announce(`탈퇴하지 못했어요. ${message}`, { politeness: 'assertive' })
      }
    } finally {
      busyRef.current = false
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      alert
      onClose={close}
      title="정말 탈퇴할까요?"
      description="탈퇴하면 이 계정으로 로그인할 수 없어요. 같은 이메일로 다시 가입할 수는 있어요."
      kicker={<p className="font-bold text-danger">되돌릴 수 없어요</p>}
      initialFocusRef={cancelRef}
      hideCloseButton
      className="overflow-y-auto text-xl"
      titleClassName="text-[2rem]"
    >
      <form
        key={String(open)}
        noValidate
        onSubmit={(e) => void submit(e)}
        className="space-y-6"
        aria-busy={pending}
      >
        {failure && <p className="font-bold text-danger">{failure}</p>}
        <PasswordField
          ref={passwordRef}
          label="비밀번호"
          autoComplete="current-password"
          required
          readOnly={pending}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
        />
        <div className="flex flex-wrap gap-4">
          {/* 대화상자 버튼 규칙: 취소 = 흰색(secondary), 위험한 동작 = 빨강(danger) */}
          <Button ref={cancelRef} variant="secondary" size="xl" disabled={pending} onClick={close}>
            취소
          </Button>
          <Button type="submit" variant="danger" size="xl" loading={pending}>
            {pending ? '탈퇴하는 중' : '탈퇴하기'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
