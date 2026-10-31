import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { cn } from './cn'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** 낭독기가 읽을 제목 */
  label: string
  /** 입력 형식 안내 */
  hint?: string
  /** 오류 문구. 있으면 aria-invalid 가 켜지고 이름 다음에 읽힌다 */
  error?: string
  end?: ReactNode
  ref?: Ref<HTMLInputElement>
}

/**
 * 글자 입력칸. 제출 실패 시 페이지가 첫 오류 칸으로 포커스를 옮기면, 이름 → 오류 문구 순서로 읽힌다.
 */
export function TextField({ label, hint, error, end, className, ref, ...rest }: TextFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="font-bold text-ink">
        {label}
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
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="min-h-14 min-w-0 flex-1 bg-transparent px-4 text-lg focus-visible:outline-none"
          {...rest}
        />
        {end}
      </div>
      {error && (
        <p id={errorId} className="font-bold text-danger">
          {error}
        </p>
      )}
    </div>
  )
}