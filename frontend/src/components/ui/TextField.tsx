import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { cn } from './cn'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** 화면에 보이는 이름. 낭독기도 이 이름으로 읽는다 (placeholder 로 대신하지 않는다) */
  label: string
  /** 입력 형식 안내. 입력칸에 포커스가 오면 이름 다음에 읽힌다 */
  hint?: string
  /** 오류 문구. 있으면 aria-invalid 가 켜지고 이름 다음에 읽힌다 */
  error?: string
  /** 확인 결과 문구 ("사용할 수 있는 이메일이에요"). 오류가 없을 때만 보인다 */
  success?: string
  /** 입력칸 오른쪽에 붙일 요소 (비밀번호 보기 버튼 등) */
  end?: ReactNode
  ref?: Ref<HTMLInputElement>
}

/**
 * 글자 입력칸. 오류를 스스로 낭독하지 않는다:
 * 제출 실패 시 페이지가 첫 오류 칸으로 포커스를 옮기면, 이름 → 오류 문구 순서로 읽힌다.
 */
export function TextField({
  label,
  hint,
  error,
  success,
  end,
  required,
  className,
  ref,
  ...rest
}: TextFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const successId = `${id}-success`
  const showSuccess = !error && success
  const describedBy =
    [hint && hintId, error && errorId, showSuccess && successId].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="text-lg font-bold text-ink">
        {label}
        {/* 낭독기는 input 의 required 로 '필수'를 읽으므로 화면 표시는 숨긴다 */}
        {required && (
          <span aria-hidden="true" className="ml-2 text-sm font-normal text-danger">
            필수
          </span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-ink-muted">
          {hint}
        </p>
      )}
      <div
        className={cn(
          'flex items-center rounded-md border-2 bg-paper',
          'has-[input:focus-visible]:border-ink has-[input:focus-visible]:bg-yellow-soft',
          error ? 'border-danger' : 'border-line',
        )}
      >
        <input
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="min-h-14 min-w-0 flex-1 bg-transparent px-4 text-xl focus-visible:outline-none"
          {...rest}
        />
        {end}
      </div>
      {error && (
        <p id={errorId} className="flex items-center gap-2 font-bold text-danger">
          <span aria-hidden="true">●</span>
          {error}
        </p>
      )}
      {showSuccess && (
        <p id={successId} className="flex items-center gap-2 text-success">
          <span aria-hidden="true">●</span>
          {success}
        </p>
      )}
    </div>
  )
}
