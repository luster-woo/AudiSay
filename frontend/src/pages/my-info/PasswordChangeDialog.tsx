import { useRef, useState, type FormEvent } from 'react'
import { usersApi } from '@/api/users'
import { ApiError, toUserMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { PasswordField } from '@/components/ui/PasswordField'
import { useAnnouncer } from '@/features/announcer/context'
import { isValidPassword } from '@/utils/validation'

type Field = 'current' | 'next' | 'confirm'
type Errors = Partial<Record<Field, string>>

export function PasswordChangeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { announce } = useAnnouncer()
  const currentRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState('')
  const [pending, setPending] = useState(false)

  const close = () => {
    if (busyRef.current) return
    setCurrent('')
    setNext('')
    setConfirm('')
    setErrors({})
    setFailure('')
    onClose()
  }

  const fail = (nextErrors: Errors) => {
    setErrors(nextErrors)
    const first = (['current', 'next', 'confirm'] as const).find((key) => nextErrors[key])
    if (!first) return
    const refs = { current: currentRef, next: nextRef, confirm: confirmRef }
    requestAnimationFrame(() => {
      refs[first].current?.focus()
      announce(`비밀번호를 바꾸지 못했어요. ${nextErrors[first]}`, { politeness: 'assertive' })
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busyRef.current) return
    setFailure('')
    const nextErrors: Errors = {}
    if (!current) nextErrors.current = '현재 비밀번호를 입력해 주세요.'
    if (!isValidPassword(next) || /\s/.test(next))
      nextErrors.next = '공백 없이 8~20자로, 영문·숫자·특수문자를 모두 넣어 주세요.'
    if (!confirm) nextErrors.confirm = '새 비밀번호를 한 번 더 입력해 주세요.'
    else if (confirm !== next) nextErrors.confirm = '새 비밀번호가 서로 달라요.'
    if (Object.keys(nextErrors).length) return fail(nextErrors)
    setErrors({})
    busyRef.current = true
    setPending(true)
    try {
      await usersApi.changePassword(current, next)
      busyRef.current = false
      close()
      announce('비밀번호를 바꿨어요. 다른 기기에서는 로그아웃돼요.')
    } catch (error) {
      if (error instanceof ApiError && error.code === 'USER_002') {
        setCurrent('')
        fail({ current: '현재 비밀번호가 맞지 않아요. 다시 입력해 주세요.' })
      } else {
        const message = toUserMessage(error)
        setFailure(message)
        announce(`비밀번호를 바꾸지 못했어요. ${message}`, { politeness: 'assertive' })
      }
    } finally {
      busyRef.current = false
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="비밀번호 바꾸기"
      description="현재 비밀번호와 새 비밀번호를 입력해 주세요. 다른 기기에서는 로그아웃돼요."
      initialFocusRef={currentRef}
      hideCloseButton
      className="overflow-y-auto text-xl"
      titleClassName="text-[2rem]"
    >
      <form
        key={String(open)}
        noValidate
        onSubmit={(e) => void submit(e)}
        className="space-y-5"
        aria-busy={pending}
      >
        {failure && <p className="font-bold text-danger">{failure}</p>}
        <PasswordField
          ref={currentRef}
          label="현재 비밀번호"
          autoComplete="current-password"
          required
          readOnly={pending}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={errors.current}
        />
        <PasswordField
          ref={nextRef}
          label="새 비밀번호"
          autoComplete="new-password"
          hint="공백 없이 8~20자, 영문·숫자·특수문자 포함"
          required
          readOnly={pending}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={errors.next}
        />
        <PasswordField
          ref={confirmRef}
          label="새 비밀번호 확인"
          autoComplete="new-password"
          required
          readOnly={pending}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <div className="flex flex-wrap gap-4 pt-3">
          <Button variant="secondary" size="xl" disabled={pending} onClick={close}>
            취소
          </Button>
          <Button type="submit" variant="accent" size="xl" loading={pending}>
            {pending ? '바꾸는 중' : '비밀번호 바꾸기'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
