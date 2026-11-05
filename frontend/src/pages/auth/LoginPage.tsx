import { useId, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { ApiError, toUserMessage } from '@/api/errors'
import { useAnnouncer } from '@/features/announcer/context'
import { useAuth } from '@/features/auth/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { Notice } from '@/components/ui/Notice'
import { PasswordField } from '@/components/ui/PasswordField'
import { TextField } from '@/components/ui/TextField'
import { isEmail } from '@/utils/validation'

interface Errors {
  email?: string
  password?: string
}

export default function LoginPage() {
  const { login } = useAuth()
  const { announce } = useAnnouncer()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  // 회원가입을 마치고 넘어왔으면 그 이메일 (가입은 로그인을 하지 않는다)
  const signedUpEmail = (useLocation().state as { signedUpEmail?: string } | null)?.signedUpEmail

  const [email, setEmail] = useState(signedUpEmail ?? '')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [summary, setSummary] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const headingId = useId()

  usePageEntry({
    title: '로그인',
    announce: signedUpEmail
      ? '가입했어요. 이메일을 채워 뒀어요. 비밀번호를 넣고 로그인해 주세요. 비밀번호 칸에 있어요.'
      : '로그인 화면이에요. 이메일 칸에 있어요.',
    focusRef: signedUpEmail ? passwordRef : emailRef,
  })

  /**
   * 오류 알리기: 오류 칸으로 포커스를 먼저 옮기고(이름·오류 문구가 읽힘),
   * 안내 띠 문구는 그 뒤에 polite 로 이어 읽힌다 — assertive 로 하면 포커스 낭독을 끊는다.
   */
  const fail = (next: Errors, summaryText: string, bandText: string) => {
    setErrors(next)
    setSummary(summaryText)
    const target = next.email ? emailRef.current : passwordRef.current
    target?.focus()
    requestAnimationFrame(() => announce(bandText))
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const next: Errors = {}
    if (!email.trim()) next.email = '이메일을 입력해 주세요.'
    else if (!isEmail(email)) next.email = '이메일 형식이 아니에요. 예: haneul@example.com'
    if (!password) next.password = '비밀번호를 입력해 주세요.'
    if (next.email || next.password) {
      const first = next.email ?? next.password!
      fail(next, first, `로그인하지 못했어요. ${first}`)
      return
    }

    setSubmitting(true)
    try {
      await login(email.trim(), password) // 성공하면 login() 이 역할에 맞는 화면으로 옮긴다
    } catch (err) {
      setPassword('')
      if (err instanceof ApiError && err.code === 'AUTH_001') {
        fail(
          { password: '비밀번호를 다시 입력해 주세요.' },
          '이메일 또는 비밀번호가 일치하지 않아요. 비밀번호 칸으로 옮겼어요.',
          '로그인하지 못했어요. 이메일 또는 비밀번호가 일치하지 않아요.',
        )
      } else {
        const msg = toUserMessage(err)
        fail({}, msg, `로그인하지 못했어요. ${msg}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <p className="text-lg font-bold text-ink-muted">AudiSay 계정</p>
      <h1 id={headingId} className="mt-2 text-[2.5rem] font-bold">
        로그인
      </h1>

      {summary ? (
        <Notice title="로그인하지 못했어요" className="mt-8 max-w-[35rem]">
          {summary}
        </Notice>
      ) : (
        signedUpEmail && (
          <Notice title="가입했어요" tone="success" className="mt-8 max-w-[35rem]">
            비밀번호를 넣고 로그인하면 사용법 안내가 시작돼요.
          </Notice>
        )
      )}

      {/* 이름 있는 서식 랜드마크: '로그인 서식 랜드마크' 로 읽힌다 */}
      <form
        noValidate
        aria-labelledby={headingId}
        onSubmit={onSubmit}
        className="mt-6 flex max-w-[35rem] flex-col gap-5"
      >
        <TextField
          ref={emailRef}
          label="이메일"
          type="email"
          autoComplete="email"
          placeholder="이메일 주소"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <PasswordField
          ref={passwordRef}
          label="비밀번호"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <div>
          <Button type="submit" size="lg" loading={submitting} className="min-w-[12.5rem]">
            {submitting ? '로그인하는 중' : '로그인'}
          </Button>
        </div>
      </form>

      <section
        aria-labelledby="first-time"
        className="mt-8 max-w-[44rem] pt-7 before:block before:max-w-[35rem] before:border-t-2 before:border-line before:-mt-7 before:mb-7 before:content-['']"
      >
        <h2 id="first-time" className="text-2xl font-bold">
          처음이세요?
        </h2>
        <p className="mt-4 text-xl">
          회원가입은 1분이면 끝나요. 가입하고 처음 로그인하면 사용법 안내가 바로 시작돼요.
        </p>
        <ButtonLink to="/signup" size="lg" className="mt-4 min-w-[12.5rem]">
          회원가입하기
        </ButtonLink>
      </section>
    </div>
  )
}
