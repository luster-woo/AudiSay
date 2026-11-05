import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api/auth'
import { ApiError, toUserMessage } from '@/api/errors'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { Notice } from '@/components/ui/Notice'
import { PasswordField } from '@/components/ui/PasswordField'
import { TextField } from '@/components/ui/TextField'
import { TermsAgreement, type Agreement } from '@/features/terms/TermsAgreement'
import { isEmail, isValidPassword } from '@/utils/validation'

type Field = 'name' | 'email' | 'password' | 'confirm' | 'terms'
type Errors = Partial<Record<Field, string>>
/** 이메일 중복 확인 상태 */
type EmailCheck = 'idle' | 'checking' | 'available' | 'taken'

const ORDER: Field[] = ['name', 'email', 'password', 'confirm', 'terms']

export default function SignupPage() {
  const navigate = useNavigate()
  const { announce } = useAnnouncer()
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const termsRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agreement, setAgreement] = useState<Agreement>({ terms: false, privacy: false })
  const [emailCheck, setEmailCheck] = useState<EmailCheck>('idle')
  const [errors, setErrors] = useState<Errors>({})
  const [summary, setSummary] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  usePageEntry({
    title: '회원가입',
    announce: '회원가입 화면이에요. 칸 4개와 약관 동의가 있어요. 이름 칸에 있어요.',
    focusRef: nameRef,
  })

  const setError = (field: Field, message?: string) =>
    setErrors((prev) => ({ ...prev, [field]: message }))

  /** 이메일 칸을 벗어날 때 미리 확인한다. 결과는 칸 아래 문구 + 안내 띠로 알린다 */
  const checkEmail = async (value = email): Promise<boolean> => {
    const v = value.trim()
    if (!v) return false
    if (!isEmail(v)) {
      setError('email', '이메일 형식이 아니에요. 예: haneul@example.com')
      return false
    }
    setEmailCheck('checking')
    try {
      const { available } = await authApi.checkEmail(v)
      setEmailCheck(available ? 'available' : 'taken')
      setError('email', available ? undefined : '이미 사용 중인 이메일이에요.')
      announce(available ? '사용할 수 있는 이메일이에요.' : '이미 사용 중인 이메일이에요.')
      return available
    } catch (err) {
      setEmailCheck('idle')
      setError('email', toUserMessage(err))
      return false
    }
  }

  const validate = (): Errors => {
    const next: Errors = {}
    if (!name.trim()) next.name = '이름을 입력해 주세요.'
    else if (name.trim().length > 50) next.name = '이름은 50자까지 쓸 수 있어요.'
    if (!email.trim()) next.email = '이메일을 입력해 주세요.'
    else if (!isEmail(email)) next.email = '이메일 형식이 아니에요. 예: haneul@example.com'
    else if (emailCheck === 'taken') next.email = '이미 사용 중인 이메일이에요.'
    if (!password) next.password = '비밀번호를 입력해 주세요.'
    else if (!isValidPassword(password))
      next.password = '8~20자로, 영문·숫자·특수문자를 모두 넣어 주세요.'
    if (!confirm) next.confirm = '비밀번호를 한 번 더 입력해 주세요.'
    else if (confirm !== password) next.confirm = '비밀번호가 서로 달라요.'
    if (!agreement.terms || !agreement.privacy)
      next.terms = '이용약관과 개인정보 수집·이용에 모두 동의해야 가입할 수 있어요.'
    return next
  }

  const fail = (next: Errors) => {
    setErrors(next)
    const fields = ORDER.filter((f) => next[f])
    const first = fields[0]
    const text = `${fields.length}개 칸을 확인해 주세요.`
    setSummary(text)
    const refOf = {
      name: nameRef,
      email: emailRef,
      password: passwordRef,
      confirm: confirmRef,
      terms: termsRef,
    }
    refOf[first].current?.focus()
    requestAnimationFrame(() => announce(`가입하지 못했어요. ${text} ${next[first]}`))
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const next = validate()
    if (Object.values(next).some(Boolean)) return fail(next)

    // 칸을 벗어나지 않고 바로 가입을 누른 경우 여기서 중복 확인
    if (emailCheck !== 'available' && !(await checkEmail())) {
      return fail({ email: '이미 사용 중인 이메일이에요.' })
    }

    setSubmitting(true)
    try {
      await authApi.signup({ name: name.trim(), email: email.trim(), password, termsAgreed: true })
      // 가입만 하고 로그인은 하지 않는다. 로그인 화면에서 직접 로그인하면 사용법이 시작된다
      navigate('/login', { replace: true, state: { signedUpEmail: email.trim() } })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'USER_001') {
        setEmailCheck('taken')
        fail({ email: '이미 사용 중인 이메일이에요.' })
      } else {
        const msg = toUserMessage(err)
        setSummary(msg)
        announce(`가입하지 못했어요. ${msg}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-[38rem]">
      <p className="text-lg font-bold text-ink-muted">AudiSay 계정</p>
      <h1 className="mt-2 text-[2.5rem] font-bold">회원가입</h1>
      <p className="mt-2 text-lg text-ink-muted">칸 4개를 모두 채우고 약관에 동의하면 가입돼요.</p>

      {summary && (
        <Notice title="가입하지 못했어요" className="mt-8">
          {summary}
        </Notice>
      )}

      <form noValidate onSubmit={onSubmit} className="mt-6 flex flex-col gap-5">
        <TextField
          ref={nameRef}
          label="이름"
          required
          autoComplete="name"
          placeholder="이름"
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <TextField
          ref={emailRef}
          label="이메일"
          required
          type="email"
          autoComplete="email"
          placeholder="이메일 주소"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setEmailCheck('idle')
            setError('email', undefined)
          }}
          onBlur={() => void checkEmail()}
          error={errors.email}
          success={emailCheck === 'available' ? '사용할 수 있는 이메일이에요.' : undefined}
        />
        <PasswordField
          ref={passwordRef}
          label="비밀번호"
          required
          hint="8~20자, 영문·숫자·특수문자를 모두 넣어요."
          autoComplete="new-password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <TextField
          ref={confirmRef}
          label="비밀번호 확인"
          required
          type="password"
          autoComplete="new-password"
          placeholder="한 번 더 입력"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <TermsAgreement
          ref={termsRef}
          value={agreement}
          onChange={(next) => {
            setAgreement(next)
            if (next.terms && next.privacy) setError('terms', undefined)
          }}
          error={errors.terms}
        />
        <p className="-mt-1 text-base text-ink-muted">
          시각장애인 인증(복지카드)에 필요한 민감정보 동의는 다음 단계인 인증 화면에서 따로 받아요.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" loading={submitting} className="min-w-[10rem]">
            {submitting ? '가입하는 중' : '가입하기'}
          </Button>
          <ButtonLink to="/login" size="lg" className="min-w-[10rem]">
            이미 회원이에요
          </ButtonLink>
        </div>
      </form>
    </div>
  )
}
