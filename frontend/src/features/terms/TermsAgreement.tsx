import { useId, useState, type Ref } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { PRIVACY, TERMS, type TermsDocument } from './documents'
import { TermsDialog } from './TermsDialog'

export interface Agreement {
  terms: boolean
  privacy: boolean
}

/**
 * 회원가입의 '약관 동의' 묶음. fieldset + legend 라 낭독기가 "약관 동의 그룹"이라고 먼저 읽는다.
 * - '모두 동의해요'는 둘을 한 번에 켜고 끈다. 하나만 켜져 있으면 부분 선택.
 * - 필수 두 칸은 요약이 aria-describedby 로 붙어, 체크에 닿으면 이름표 뒤에 요약이 바로 읽힌다.
 * - '전문 보기'는 버튼이고 이름에 어느 약관인지 들어간다. 읽지 않아도 체크할 수 있다.
 * - 시각장애인 인증에 필요한 민감정보 동의는 여기 묶지 않는다(인증 화면에서 따로).
 */
export function TermsAgreement({
  value,
  onChange,
  error,
  ref,
}: {
  value: Agreement
  onChange: (next: Agreement) => void
  /** 둘 다 켜지지 않았을 때의 오류 문구 */
  error?: string
  /** 가입 실패 시 포커스를 옮길 첫 체크 칸 */
  ref?: Ref<HTMLInputElement>
}) {
  // 창은 늘 그려 두고 open 만 바꾼다. 떼어 내면 닫힐 때 '전문 보기' 버튼으로 포커스를 돌려보내지 못한다
  const [doc, setDoc] = useState<TermsDocument>(TERMS)
  const [open, setOpen] = useState(false)
  const show = (d: TermsDocument) => {
    setDoc(d)
    setOpen(true)
  }
  const errorId = useId()
  const all = value.terms && value.privacy
  const some = value.terms || value.privacy

  return (
    <fieldset className="rounded-lg border-2 border-navy px-8 pt-2 pb-6">
      <legend className="px-2 text-xl font-bold">약관 동의</legend>

      <Checkbox
        label={<span className="font-bold">모두 동의해요</span>}
        checked={all}
        indeterminate={!all && some}
        onChange={(e) => onChange({ terms: e.target.checked, privacy: e.target.checked })}
      />
      <hr className="my-2 border-line" />

      <ConsentRow
        doc={TERMS}
        label="이용약관에 동의해요"
        viewLabel="이용약관 전문 보기"
        checked={value.terms}
        onCheck={(checked) => onChange({ ...value, terms: checked })}
        onView={() => show(TERMS)}
        invalid={!!error && !value.terms}
        errorId={error ? errorId : undefined}
        ref={ref}
      />
      <hr className="my-4 border-t-2 border-dashed border-line" />
      <ConsentRow
        doc={PRIVACY}
        label="개인정보 수집·이용에 동의해요"
        viewLabel="개인정보 안내 전문 보기"
        checked={value.privacy}
        onCheck={(checked) => onChange({ ...value, privacy: checked })}
        onView={() => show(PRIVACY)}
        invalid={!!error && !value.privacy}
        errorId={error ? errorId : undefined}
      />

      {error && (
        <p id={errorId} className="mt-4 flex items-center gap-2 font-bold text-danger">
          <span aria-hidden="true">●</span>
          {error}
        </p>
      )}

      <TermsDialog
        doc={doc}
        open={open}
        onClose={() => setOpen(false)}
        onAgree={() => {
          onChange({ ...value, [doc.key]: true })
          setOpen(false)
        }}
      />
    </fieldset>
  )
}

function ConsentRow({
  doc,
  label,
  viewLabel,
  checked,
  onCheck,
  onView,
  invalid,
  errorId,
  ref,
}: {
  doc: TermsDocument
  label: string
  viewLabel: string
  checked: boolean
  onCheck: (checked: boolean) => void
  onView: () => void
  invalid: boolean
  errorId?: string
  ref?: Ref<HTMLInputElement>
}) {
  const summaryId = useId()
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox
          ref={ref}
          label={
            <>
              <span className="font-bold text-danger">[필수]</span> {label}
            </>
          }
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          required
          aria-invalid={invalid || undefined}
          aria-describedby={[summaryId, invalid ? errorId : undefined].filter(Boolean).join(' ')}
        />
        <Button variant="secondary" size="md" onClick={onView}>
          {viewLabel}
        </Button>
      </div>
      <p
        id={summaryId}
        className="mt-2 ml-9 border-l-4 border-navy bg-line/40 px-5 py-3 text-base leading-relaxed text-ink"
      >
        {doc.summary}
      </p>
    </div>
  )
}
