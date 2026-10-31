import { useState } from 'react'
import { TextField, type TextFieldProps } from './TextField'

export function PasswordField(props: Omit<TextFieldProps, 'type' | 'end'>) {
  const [shown, setShown] = useState(false)

  return (
    <TextField
      {...props}
      type={shown ? 'text' : 'password'}
      end={
        <button
          type="button"
          aria-label={shown ? '비밀번호 숨기기' : '비밀번호 보기'}
          onClick={() => setShown((v) => !v)}
          className="mr-2 min-h-touch rounded-sm px-3 font-bold text-ink"
        >
          {shown ? '숨기기' : '보기'}
        </button>
      }
    />
  )
}