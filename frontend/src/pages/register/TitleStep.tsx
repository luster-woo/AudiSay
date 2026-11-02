import { useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { formatSize } from '@/features/upload/fileRules'
import { formatDurationSpoken } from '@/utils/time'
import type { PickedFile } from './PickStep'

/** 2/3단계: 제목 정하기 (파일 이름으로 미리 채움) */
export function TitleStep({
  picked,
  defaultTitle,
  onNext,
}: {
  picked: PickedFile
  defaultTitle: string
  onNext: (title: string) => void
}) {
  const { announce } = useAnnouncer()
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(defaultTitle)
  const [error, setError] = useState<string>()

  usePageEntry({
    title: '제목 정하기',
    announce: '제목 칸에 있어요. 파일 이름으로 채워 두었어요.',
    focusRef: inputRef,
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const value = title.trim()
    if (!value) {
      setError('제목을 입력해 주세요.')
      inputRef.current?.focus()
      requestAnimationFrame(() => announce('제목을 입력해 주세요.', { politeness: 'assertive' }))
      return
    }
    onNext(value)
  }

  const { file, durationSec } = picked
  return (
    <div className="max-w-[60rem]">
      <p className="text-2xl font-bold text-navy">영상 올리기 · 2/3단계</p>
      <h1 className="mt-6 text-[2.75rem] font-bold">영상 제목을 정해 주세요</h1>
      <p className="mt-8 flex items-center gap-2 text-2xl font-bold text-success">
        <span aria-hidden="true">✓</span>
        <span className="sr-only">고른 파일:</span>
        {file.name} · {formatDurationSpoken(durationSec)} · {formatSize(file.size)}
      </p>

      <form noValidate onSubmit={onSubmit} className="mt-10">
        <TextField
          ref={inputRef}
          label="제목"
          hint="파일 이름으로 채워 두었어요. 그대로 써도 돼요."
          maxLength={300}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setError(undefined)
          }}
          error={error}
          className="[&_input]:min-h-24 [&_input]:px-6 [&_input]:text-[2rem] [&_label]:text-2xl [&>p]:order-last [&>p]:text-xl"
        />
        <Button type="submit" size="hero" className="mt-10 w-full">
          다음
        </Button>
      </form>
    </div>
  )
}
