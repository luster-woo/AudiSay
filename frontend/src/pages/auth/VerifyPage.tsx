import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import { tokenStore } from '@/api/token'
import { ApiError, toUserMessage } from '@/api/errors'
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

/** 실패 안내. 서류 거절(USER_006)·하루 초과(USER_007)·확인 밀림(USER_008)은 서버 문구를 그대로 읽는다 */
interface SubmitError {
  title: string
  message: string
}

function toSubmitError(err: unknown): SubmitError & { code?: string } {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'USER_006':
        return {
          code: err.code,
          title: '서류를 확인하지 못했어요',
          message: `${err.message} 파일을 다시 골라 올려 주세요.`,
        }
      case 'USER_007':
        return { code: err.code, title: '오늘은 더 신청할 수 없어요', message: err.message }
      case 'USER_008':
        return { code: err.code, title: '지금은 확인할 수 없어요', message: err.message }
    }
  }
  return { title: '인증하지 못했어요', message: toUserMessage(err) }
}

export default function VerifyPage() {
  const queryClient = useQueryClient()
  const { user, updateUser } = useAuth()
  const { announce } = useAnnouncer()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const agreeRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const fileStatusId = useId()
  const agreeHintId = useId()

  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [agreeError, setAgreeError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<SubmitError | null>(null)
  const [submitting, setSubmitting] = useState(false)
  /** 오늘 시도 횟수를 다 씀 (USER_007). 다시 눌러도 같은 답이라 버튼을 막는다 */
  const [blocked, setBlocked] = useState(false)
  const [done, setDone] = useState(false)

  // 이미 인증한 회원은 이 화면에서 할 일이 없으므로 내 정보로 보낸다 (주소를 직접 입력해 들어온 경우).
  // 기준은 내 정보 화면과 같다: 역할이 시각장애인이거나 인증 표시가 있으면 인증한 회원.
  // 방금 이 화면에서 인증을 끝낸 경우(done)는 완료 안내를 보여 주어야 하므로 보내지 않는다
  const alreadyVerified = !done && (user?.role === 'VISUALLY_IMPAIRED' || user?.verified === true)

  usePageEntry({
    title: '시각장애인 인증',
    announce: '시각장애인 인증 화면이에요. 서류 한 장만 올리면 돼요.',
    focusRef: headingRef,
    ready: !alreadyVerified,
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
    setSubmitError(null)
    announce('서류를 확인하고 있어요. 잠시 기다려 주세요.')
    try {
      const res = await usersApi.verify(file!)
      // 역할이 AccessToken 에 담기므로 새 토큰으로 바꾼다 (API 명세)
      tokenStore.set(res.accessToken)
      // done 을 역할 변경과 같은 렌더에 넣는다. 그렇지 않으면 '이미 인증한 회원' 으로 보고 내 정보로 보내 버린다
      setDone(true)
      updateUser({ role: res.role, verified: true })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.me, exact: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.quota, exact: true }),
      ])
      requestAnimationFrame(() => {
        headingRef.current?.focus()
        announce('시각장애인 인증이 끝났어요. 이제 60분까지 해설을 만들 수 있어요.')
      })
    } catch (err) {
      const e = toSubmitError(err)
      setSubmitError(e)
      if (e.code === 'USER_007') setBlocked(true)
      if (e.code === 'USER_006') {
        // 같은 파일로는 다시 거절되므로 고른 파일을 비우고 파일 고르기로 보낸다
        setFile(null)
        if (fileRef.current) fileRef.current.value = ''
        fileRef.current?.focus()
      }
      announce(`${e.title}. ${e.message}`, { politeness: 'assertive' })
    } finally {
      setSubmitting(false)
    }
  }

  if (alreadyVerified) return <Navigate to="/me" replace />

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_24rem]">
      <div>
        <Link to="/me" className="inline-flex min-h-touch items-center gap-2 font-bold text-ink">
          <span aria-hidden="true">←</span>내 정보
        </Link>
        <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-4xl font-bold outline-none">
          {done ? '인증이 끝났어요' : '시각장애인 인증'}
        </h1>

        {done ? (
          <>
            <p className="mt-4 text-xl text-ink-muted">
              이제 더 긴 영상의 해설을 만들고, 하루에 더 많이 이용할 수 있어요.
            </p>
            <ButtonLink to="/" variant="primary" size="lg" className="mt-8">
              홈으로 가기
            </ButtonLink>
          </>
        ) : (
          <>
            <p className="mt-4 text-xl text-ink-muted">
              서류 한 장을 올리면 바로 확인해요. 서류는 글자를 읽어 종류만 확인하고 어디에도
              저장하지 않아요.
            </p>

            {submitError && (
              <Notice title={submitError.title} className="mt-8">
                {submitError.message}
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
                  aria-describedby={agreeError ? `${agreeHintId} agree-error` : agreeHintId}
                />
                <p id={agreeHintId} className="mt-1 text-lg text-ink-muted">
                  서류의 글자를 읽어 복지카드·장애인증명서인지와 장애 유형만 확인해요. 서류와 읽은
                  글자는 저장하지 않아요.
                </p>
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
                <Button
                  type="submit"
                  variant="accent"
                  size="lg"
                  loading={submitting}
                  disabled={blocked}
                >
                  {submitting ? '서류를 확인하는 중' : '인증 신청'}
                </Button>
                <Link to="/" className="min-h-touch content-center font-bold text-navy underline">
                  나중에 할게요
                </Link>
              </div>
              {submitting && (
                <p className="text-lg text-ink-muted">서류를 확인하고 있어요. 길면 1분쯤 걸려요.</p>
              )}
            </form>
          </>
        )}
      </div>

      {/* TODO: 수치는 /users/me/quota 연동 시 API 값으로 교체 (지금은 와이어프레임 값) */}
      <aside aria-labelledby="verify-benefit" className="border-t-2 border-line pt-6">
        <h2 id="verify-benefit" className="text-2xl font-bold">
          인증하면 달라지는 것
        </h2>
        <div className="mt-6 space-y-6">
          {BENEFITS.map((b) => (
            <BenefitChange key={b.title} {...b} />
          ))}
        </div>
      </aside>
    </div>
  )
}

/** 인증 전후 비교 (와이어프레임 값) */
const BENEFITS: { title: string; rows: { label: string; now: string; after: string }[] }[] = [
  {
    title: '유튜브 해설',
    rows: [
      { label: '영상 길이', now: '10분 이하', after: '60분 이하' },
      { label: '일일 해설 요청', now: '5개', after: '10개' },
    ],
  },
  {
    title: '내 영상 해설',
    rows: [
      { label: '영상 길이', now: '5분 · 0.5GB 이하', after: '60분 · 2GB 이하' },
      { label: '일일 해설 요청', now: '1개', after: '3개' },
    ],
  },
]

/**
 * 항목 하나의 '지금 → 인증 후' 변화. 표 대신 화살표로 바뀌는 방향을 보여 준다.
 * 지금 값은 흐리게, 인증 후 값은 진한 글자(text-ink, 고대비에서는 흰색)로 굵게 보인다.
 * 화살표는 장식이라 숨기고, 낭독기에는 "영상 길이, 지금 10분 이하, 인증하면 60분 이하"처럼 읽힌다.
 */
function BenefitChange({ title, rows }: (typeof BENEFITS)[number]) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-xl font-bold">
        {title}
      </h3>
      <ul className="mt-2 divide-y divide-line rounded-md border-2 border-line bg-paper">
        {rows.map((r) => (
          <li key={r.label} className="px-4 py-3">
            <p className="text-base font-bold">{r.label}</p>
            {/* 좁은 화면·큰 글자에서는 인증 후 값이 다음 줄로 내려가도 화살표가 앞에 붙어 간다 */}
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-lg whitespace-nowrap text-ink-muted">
                <span className="sr-only">지금 </span>
                <EmphasizeNumbers text={r.now} />
              </span>
              <span className="flex items-center gap-3 whitespace-nowrap">
                <ChangeArrow />
                <span className="text-lg font-bold text-ink">
                  <span className="sr-only">, 인증하면 </span>
                  <EmphasizeNumbers text={r.after} />
                </span>
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 오른쪽 화살표 (장식). 글자 크기 설정을 따라 커진다 */
function ChangeArrow() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[1.5em] w-[1.5em] shrink-0 text-navy"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  )
}

/**
 * "60분 · 2GB 이하" 의 숫자만 조금 크게·굵게. 낭독은 글자 그대로 이어서 읽힌다.
 * 크기는 글자의 1.3배 (글자 크기 설정에 따라 함께 커진다).
 * Pretendard 한글은 기준선 아래로 약 0.08em 내려오고 숫자는 기준선에 붙어 있어, 숫자를 키우면 아랫선이 숫자 쪽이 더 높아 보인다.
 * 숫자를 0.05em 내려(relative, 줄 높이에는 영향 없음) 한글과 아랫선을 맞춘다 (실측 차이 1.25px → 0.5px 이하)
 */
function EmphasizeNumbers({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+(?:\.\d+)?)/).map((part, i) =>
        /^\d+(?:\.\d+)?$/.test(part) ? (
          <span key={i} className="relative top-[0.05em] text-[1.3em] font-extrabold tabular-nums">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}
