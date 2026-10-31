import { useState } from 'react'
import { TextField, type TextFieldProps } from './TextField'

/** 비밀번호 칸 + '보기' 토글. 토글은 aria-pressed 로 켜짐/꺼짐을 알린다 */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'end'>) {
  const [shown, setShown] = useState(false)

  return (
    <TextField
      {...props}
      type={shown ? 'text' : 'password'}
      end={
        <button
          type="button"
          aria-label="비밀번호 보기"
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
          className="mr-2 min-h-touch rounded-sm px-3 font-bold text-ink"
        >
          보기
        </button>
      }
    />
  )
}