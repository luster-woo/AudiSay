import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { cn } from './cn'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  label: ReactNode
  /** 일부만 선택됨 (전체 선택 체크박스). 낭독기는 '부분 선택됨'으로 읽는다 */
  indeterminate?: boolean
  /** 바깥에서 포커스를 옮길 때 (가입 실패 시 약관 칸으로 이동 등) */
  ref?: Ref<HTMLInputElement>
}

/** 기본 체크박스. 모양만 바꾸고 동작·낭독은 브라우저 기본을 그대로 쓴다 */
export function Checkbox({ label, indeterminate = false, className, ref, ...rest }: CheckboxProps) {
  const id = useId()
  const inner = useRef<HTMLInputElement>(null)

  // 안쪽 ref(indeterminate 용)를 바깥 ref 로도 내보낸다
  useImperativeHandle(ref, () => inner.current as HTMLInputElement, [])

  // indeterminate 는 HTML 속성이 없고 DOM 프로퍼티로만 켤 수 있다
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <div className={cn('flex min-h-touch items-center gap-3', className)}>
      <input
        ref={inner}
        id={id}
        type="checkbox"
        // 저시력: 글자보다 큰 32px 로 두고, 체크되면 글자도 굵게 바꿔 상태를 두 가지로 보인다
        className="peer size-8 shrink-0 accent-navy"
        {...rest}
      />
      <label htmlFor={id} className="text-lg text-ink peer-checked:font-bold">
        {label}
      </label>
    </div>
  )
}
