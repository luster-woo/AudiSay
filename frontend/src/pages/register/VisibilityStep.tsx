import { useRef, useState, type FormEvent } from 'react'
import type { Visibility } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/components/ui/cn'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'

const OPTIONS: { value: Visibility; label: string; desc: string }[] = [
  { value: 'PRIVATE', label: '비공개 (기본)', desc: '나와 관리자만 볼 수 있어요.' },
  { value: 'PUBLIC', label: '공개', desc: '해설 영상 목록에 올라가요.' },
]

/** 3/3단계: 공개 범위 + 권리 동의 → 올리기 시작 */
export function VisibilityStep({
  remaining,
  submitting,
  submitError,
  onSubmit,
  onBack,
}: {
  remaining: number | null
  submitting: boolean
  /** 업로드 시작이 서버에서 거절됐을 때 문구 */
  submitError?: string
  onSubmit: (visibility: Visibility) => void
  /** 2단계(제목 정하기)로 돌아간다. 적은 제목은 그대로 남는다 */
  onBack: () => void
}) {
  const { announce } = useAnnouncer()
  const privateRef = useRef<HTMLInputElement>(null)
  const agreeRef = useRef<HTMLInputElement>(null)
  const [visibility, setVisibility] = useState<Visibility>('PRIVATE')
  const [agreed, setAgreed] = useState(false)
  const [agreeError, setAgreeError] = useState(false)

  usePageEntry({
    title: '공개 범위 정하기',
    announce: '공개 범위를 골라 주세요. 지금은 비공개예요.',
    focusRef: privateRef,
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!agreed) {
      setAgreeError(true)
      agreeRef.current?.focus()
      requestAnimationFrame(() =>
        announce('이 영상을 올릴 권리가 있는지 확인해 주세요. 동의 칸에 있어요.', {
          politeness: 'assertive',
        }),
      )
      return
    }
    onSubmit(visibility)
  }

  return (
    <div className="max-w-[60rem]">
      <p className="text-2xl font-bold text-navy">영상 올리기 · 3/3단계</p>
      <h1 className="mt-6 text-[2.75rem] font-bold">누구에게 보일까요?</h1>

      {submitError && (
        <Notice title="올리기를 시작하지 못했어요" className="mt-6">
          {submitError}
        </Notice>
      )}

      <form noValidate onSubmit={submit} className="mt-6">
        <fieldset className="space-y-6">
          <legend className="sr-only">공개 범위</legend>
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cn(
                'block cursor-pointer rounded-lg border-2 border-navy bg-paper px-10 py-7',
                // 고른 칸: 채움 색 + 굵은 테두리 + ● (원칙 10장: 색만으로 구분하지 않음)
                'has-[:checked]:border-4 has-[:checked]:border-ink has-[:checked]:bg-yellow-soft',
                'has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy has-[:focus-visible]:outline-solid',
              )}
            >
              <input
                ref={o.value === 'PRIVATE' ? privateRef : undefined}
                type="radio"
                name="visibility"
                value={o.value}
                checked={visibility === o.value}
                onChange={() => setVisibility(o.value)}
                aria-describedby={`visibility-${o.value}`}
                className="peer sr-only"
              />
              <span className="flex items-center gap-3 text-[2rem] font-bold">
                <span aria-hidden="true">{visibility === o.value ? '●' : '○'}</span>
                {o.label}
              </span>
              <span id={`visibility-${o.value}`} className="mt-2 block text-2xl text-ink-muted">
                {o.desc}
              </span>
            </label>
          ))}
        </fieldset>

        <div
          className={cn(
            'mt-6 rounded-lg border-2 bg-paper px-8 py-3',
            agreeError ? 'border-danger' : 'border-ink',
          )}
        >
          <Checkbox
            ref={agreeRef}
            label="이 영상을 올릴 권리가 저에게 있어요 (필수)"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked)
              if (e.target.checked) setAgreeError(false)
            }}
            required
            aria-invalid={agreeError || undefined}
            aria-describedby={agreeError ? 'agree-error' : undefined}
            className="[&_input]:size-10 [&_label]:text-2xl [&_label]:font-bold"
          />
          {agreeError && (
            <p
              id="agree-error"
              className="flex items-center gap-2 pb-2 text-xl font-bold text-danger"
            >
              <span aria-hidden="true">●</span>
              권리가 있는 영상만 올릴 수 있어요. 확인했으면 체크해 주세요.
            </p>
          )}
        </div>

        {/* 2단계와 같이 왼쪽 이전 단계, 오른쪽 올리기 */}
        <div className="mt-8 grid grid-cols-2 gap-4">
          <Button
            type="button"
            variant="secondary"
            size="hero"
            disabled={submitting}
            onClick={onBack}
          >
            이전 단계
          </Button>
          <Button type="submit" size="hero" loading={submitting}>
            {submitting ? '올리기를 준비하는 중' : '올리고 해설 만들기'}
          </Button>
        </div>
      </form>
      {remaining != null && (
        <p className="mt-8 text-2xl text-ink-muted">
          다 올리면 내 영상 해설 1번을 써요. 오늘 {remaining}번 남았어요.
        </p>
      )}
    </div>
  )
}
