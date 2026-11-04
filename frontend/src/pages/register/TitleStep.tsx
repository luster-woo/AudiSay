import { useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { formatSize } from '@/features/upload/fileRules'
import { formatDurationSpoken } from '@/utils/time'
import type { Limits } from '@/features/upload/fileRules'
import { useFileCheck, type PickedFile } from '@/features/upload/useFileCheck'

/** 2/3단계: 제목 정하기 (파일 이름으로 미리 채움) */
export function TitleStep({
  picked,
  defaultTitle,
  onNext,
  limits,
  onRepick,
  onBack,
}: {
  picked: PickedFile
  defaultTitle: string
  onNext: (title: string) => void
  limits: Limits
  /** '수정하기'로 다른 파일을 골랐을 때 (1단계와 같은 검사를 거친 뒤) */
  onRepick: (picked: PickedFile) => void
  /** 1단계(파일 고르기)로 돌아간다 */
  onBack: () => void
}) {
  const { announce } = useAnnouncer()
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(defaultTitle)
  const [error, setError] = useState<string>()
  // 파일을 잘못 골랐을 때: 1단계로 돌아가지 않고 이 자리에서 바로 파일 창을 연다
  const fileRef = useRef<HTMLInputElement>(null)
  const { checking, take, rejectionDialog } = useFileCheck({
    limits,
    inputRef: fileRef,
    onPicked: onRepick,
  })

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
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <p className="flex items-center gap-2 text-2xl font-bold text-success">
          <span aria-hidden="true">✓</span>
          <span className="sr-only">고른 파일:</span>
          {file.name} · {formatDurationSpoken(durationSec)} · {formatSize(file.size)}
        </p>
        {/* 보이는 글자 '수정하기'를 이름 안에 그대로 둔다 (음성 조작으로도 부를 수 있게) */}
        <Button
          variant="secondary"
          aria-label="파일 수정하기"
          disabled={checking}
          onClick={() => fileRef.current?.click()}
        >
          {checking ? '확인 중' : '수정하기'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void take(e.target.files?.[0])
            e.target.value = ''
          }}
          className="hidden"
        />
      </div>

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
        {/* 왼쪽 이전 단계, 오른쪽 다음 단계. Enter 는 다음 단계(제출)로 간다 */}
        <div className="mt-10 grid grid-cols-2 gap-4">
          <Button type="button" variant="secondary" size="hero" onClick={onBack}>
            이전 단계
          </Button>
          <Button type="submit" size="hero">
            다음 단계
          </Button>
        </div>
      </form>
      {rejectionDialog}
    </div>
  )
}
