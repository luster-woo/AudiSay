import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { usersApi } from '@/api/users'
import { tokenStore } from '@/api/token'
import { toUserMessage } from '@/api/errors'
import { useAnnouncer } from '@/features/announcer/context'
import { useAuth } from '@/features/auth/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { Checkbox } from '@/components/ui/Checkbox'
import { Notice } from '@/components/ui/Notice'
import { formatBytes } from '@/utils/validation'

const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png']
const MAX_BYTES = 10 * 1024 * 1024

/** 파일 형식·용량 검사. 서버도 같은 규칙으로 다시 검사한다 */
function checkFile(file: File): string | null {
  if (!ACCEPT.includes(file.type)) return 'PDF, JPG, PNG 파일만 올릴 수 있어요.'
  if (file.size > MAX_BYTES) return '10MB 이하 파일만 올릴 수 있어요.'
  return null
}

export default function VerifyPage() {
  const { user, updateUser } = useAuth()
  const { announce } = useAnnouncer()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const agreeRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const fileStatusId = useId()

  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [agreeError, setAgreeError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const alreadyVerified = user?.role === 'VISUALLY_IMPAIRED' && !done

  usePageEntry({
    title: '시각장애인 인증',
    announce: alreadyVerified
      ? '시각장애인 인증 화면이에요. 이미 인증된 회원이에요.'
      : '시각장애인 인증 화면이에요. 서류 한 장만 올리면 돼요.',
    focusRef: headingRef,
  })

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null
    setFile(picked)
    setSubmitError(null)
    if (!picked) return
    const err = checkFile(picked)
    setFileError(err)
    // 고른 결과는 화면에만 생기므로 말로도 알린다 (원칙 7장)
    announce(
      err ? `${picked.name}를 골랐어요. ${err}` : `${picked.name}를 골랐어요. 올릴 수 있어요.`,
    )
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const fErr = !file ? '인증 서류를 골라 주세요.' : checkFile(file)
    const aErr = agreed ? null : '장애 정보 처리에 동의해야 인증할 수 있어요.'
    setFileError(fErr)
    setAgreeError(aErr)
    if (fErr || aErr) {
      ;(fErr ? fileRef : agreeRef).current?.focus()
      requestAnimationFrame(() => announce(`인증하지 못했어요. ${fErr ?? aErr}`))
      return
    }

    setSubmitting(true)
    try {
      const res = await usersApi.verify(file!)
      // 역할이 AccessToken 에 담기므로 새 토큰으로 바꾼다 (API 명세)
      tokenStore.set(res.accessToken)
      updateUser({ role: res.role, verified: true })
      setDone(true)
      requestAnimationFrame(() => {
        headingRef.current?.focus()
        announce('시각장애인 인증이 끝났어요. 이제 60분까지 해설을 만들 수 있어요.')
      })
    } catch (err) {
      const msg = toUserMessage(err)
      setSubmitError(msg)
      announce(`인증하지 못했어요. ${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_24rem]">
      <div>
        <Link to="/me" className="inline-flex min-h-touch items-center gap-2 font-bold text-ink">
          <span aria-hidden="true">←</span>내 정보
        </Link>
        <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-4xl font-bold outline-none">
          {done ? '인증이 끝났어요' : '시각장애인 인증'}
        </h1>

        {done || alreadyVerified ? (
          <>
            <p className="mt-4 text-xl text-ink-muted">
              {done
                ? '이제 더 긴 영상의 해설을 만들고, 하루에 더 많이 이용할 수 있어요.'
                : '이미 인증된 회원이에요. 따로 할 일은 없어요.'}
            </p>
            <ButtonLink to="/" variant="primary" size="lg" className="mt-8">
              홈으로 가기
            </ButtonLink>
          </>
        ) : (
          <>
            <p className="mt-4 text-xl text-ink-muted">
              서류 한 장을 올리면 바로 적용돼요. 서류는 형식만 확인하고 어디에도 저장하지 않아요.
            </p>

            {submitError && (
              <Notice title="인증하지 못했어요" className="mt-8">
                {submitError}
              </Notice>
            )}

            <form noValidate onSubmit={onSubmit} className="mt-8 flex flex-col gap-6">
              <fieldset>
                <legend className="text-lg font-bold">인증 서류</legend>
                <p id={hintId} className="mt-2 text-xl text-ink-muted">
                  복지카드 사진이나 장애인증명서 한 장 · PDF, JPG, PNG · 10MB 이하
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  {/* 진짜 파일 입력은 숨기고, 겉의 label 을 버튼 모양으로 그린다 */}
                  <input
                    ref={fileRef}
                    id="verify-file"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    aria-label="인증 서류 파일 고르기"
                    aria-describedby={`${hintId} ${fileStatusId}`}
                    aria-invalid={fileError ? true : undefined}
                    onChange={onPick}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor="verify-file"
                    className="inline-flex min-h-touch cursor-pointer items-center rounded-md border-2 border-navy bg-paper px-8 text-lg font-bold text-navy peer-focus-visible:bg-yellow-soft peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-navy peer-focus-visible:outline-solid"
                  >
                    파일 고르기
                  </label>
                  <p id={fileStatusId} className="flex flex-wrap items-center gap-3 text-lg">
                    {file && (
                      <span className="font-bold">
                        {file.name} · {formatBytes(file.size)}
                      </span>
                    )}
                    {file && !fileError && (
                      <span className="flex items-center gap-1 text-success">
                        <span aria-hidden="true">●</span>올릴 수 있어요
                      </span>
                    )}
                    {fileError && (
                      <span className="flex items-center gap-1 font-bold text-danger">
                        <span aria-hidden="true">●</span>
                        {fileError}
                      </span>
                    )}
                  </p>
                </div>
              </fieldset>

              <div>
                <Checkbox
                  ref={agreeRef}
                  label="장애 정보(민감정보) 처리에 동의해요"
                  checked={agreed}
                  onChange={(e) => {
                    setAgreed(e.target.checked)
                    if (e.target.checked) setAgreeError(null)
                  }}
                  required
                  aria-invalid={agreeError ? true : undefined}
                  aria-describedby={agreeError ? 'agree-error' : undefined}
                />
                {agreeError && (
                  <p
                    id="agree-error"
                    className="mt-1 flex items-center gap-2 font-bold text-danger"
                  >
                    <span aria-hidden="true">●</span>
                    {agreeError}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <Button type="submit" variant="accent" size="lg" loading={submitting}>
                  {submitting ? '인증하는 중' : '인증 신청'}
                </Button>
                <Link to="/" className="min-h-touch content-center font-bold text-navy underline">
                  나중에 할게요
                </Link>
              </div>
            </form>
          </>
        )}
      </div>

      {/* TODO: 수치는 /users/me/quota 연동 시 API 값으로 교체 (지금은 와이어프레임 값) */}
      <aside aria-labelledby="verify-benefit" className="border-t-2 border-line pt-6">
        <h2 id="verify-benefit" className="text-2xl font-bold">
          인증하면 달라지는 것
        </h2>
        <dl className="mt-6 space-y-6">
          <div>
            <dt className="font-bold">유튜브 해설</dt>
            <dd className="mt-1 text-ink-muted">지금 5분 이하 · 하루 2개</dd>
            <dd className="mt-2 rounded-md bg-yellow-soft px-4 py-3 text-lg font-bold">
              인증 후 60분 이하 · 하루 5개
            </dd>
          </div>
          <div>
            <dt className="font-bold">영상 올리기</dt>
            <dd className="mt-1 text-ink-muted">지금 5분 이하 · 하루 1개</dd>
            <dd className="mt-2 rounded-md bg-yellow-soft px-4 py-3 text-lg font-bold">
              인증 후 60분 · 2GB 이하 · 하루 3개
            </dd>
          </div>
        </dl>
      </aside>
    </div>
  )
}
