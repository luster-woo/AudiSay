import { useId, useRef, useState, type DragEvent } from 'react'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/components/ui/cn'
import {
  checkFile,
  formatSize,
  readVideoDuration,
  type Limits,
  type Rejection,
} from '@/features/upload/fileRules'
import { StatusDialog } from '@/features/upload/StatusDialog'

export interface PickedFile {
  file: File
  durationSec: number
}

/** 1/3단계: 파일 고르기 (파일 창 또는 끌어다 놓기) */
export function PickStep({
  limits,
  remaining,
  onPicked,
}: {
  limits: Limits
  /** 오늘 남은 업로드 횟수. 관리자는 null(제한 없음) */
  remaining: number | null
  onPicked: (picked: PickedFile) => void
}) {
  const { announce } = useAnnouncer()
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const [checking, setChecking] = useState(false)
  const [rejection, setRejection] = useState<Rejection | null>(null)
  const [dragging, setDragging] = useState(false)
  const noneLeft = remaining === 0

  usePageEntry({
    title: '영상 등록',
    announce: noneLeft
      ? '영상 등록이에요. 오늘 올리기 횟수를 다 썼어요. 밤 12시(한국 시간)에 다시 채워져요.'
      : '영상 등록이에요. 파일 고르기 버튼에 있어요. Enter를 누르면 파일 창이 열려요.',
    focusRef: inputRef,
  })

  const take = async (file: File | undefined) => {
    if (!file || noneLeft) return
    setChecking(true)
    announce(`${file.name}을 확인하고 있어요.`)
    const durationSec = await readVideoDuration(file)
    setChecking(false)
    const problem = checkFile(file, durationSec, limits)
    if (problem || durationSec == null) {
      setRejection(
        problem ?? { reason: '영상 파일을 읽을 수 없어요.', action: '다른 파일을 골라 주세요.' },
      )
      announce('이 파일은 올릴 수 없어요. 다른 파일 고르기 버튼에 있어요.', {
        politeness: 'assertive',
      })
      return
    }
    onPicked({ file, durationSec })
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void take(e.dataTransfer.files[0])
  }

  const hint = [
    'MP4 · MOV · WebM 파일',
    limits.maxDurationSec != null && `${Math.floor(limits.maxDurationSec / 60)}분`,
    limits.maxSizeBytes != null && formatSize(limits.maxSizeBytes),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="max-w-[60rem]">
      <p className="text-2xl font-bold text-navy">영상 올리기 · 1/3단계</p>
      <h1 className="mt-6 text-[2.75rem] font-bold">올릴 영상 파일을 골라 주세요</h1>
      <p className="mt-8 text-2xl">
        {remaining == null
          ? '올리기 횟수 제한이 없어요.'
          : noneLeft
            ? '오늘은 더 올릴 수 없어요.'
            : `오늘 ${remaining}개 더 올릴 수 있어요.`}
      </p>

      {noneLeft && (
        <Notice title="오늘 올리기 횟수를 다 썼어요" className="mt-6">
          밤 12시(한국 시간)에 다시 채워져요. 이미 해설이 있는 영상은 계속 볼 수 있어요.
        </Notice>
      )}

      {/* 진짜 파일 입력은 숨기고, 뒤의 label 을 큰 상자로 그린다. 끌어다 놓기도 이 상자(label)에서 받는다 */}
      <div className="mt-8">
        <input
          ref={inputRef}
          id="video-file"
          type="file"
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
          aria-label="파일 고르기"
          aria-describedby={hintId}
          disabled={noneLeft}
          onChange={(e) => {
            void take(e.target.files?.[0])
            e.target.value = '' // 같은 파일을 다시 골라도 onChange 가 오게
          }}
          className="peer sr-only"
        />
        {/* 끌어다 놓기는 마우스 사용자를 위한 덤이다. 키보드·낭독기는 위의 파일 입력을 그대로 쓴다 */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <label
          htmlFor="video-file"
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex min-h-48 cursor-pointer flex-col justify-center gap-3 rounded-lg border-4 px-12 py-10',
            'peer-focus-visible:bg-yellow-soft peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-navy peer-focus-visible:outline-solid',
            dragging ? 'border-navy bg-yellow-soft' : 'border-ink bg-paper',
            noneLeft && 'cursor-not-allowed opacity-60',
          )}
        >
          <span className="text-[2.25rem] font-bold">
            {checking ? '파일을 확인하고 있어요' : '파일 고르기'}
          </span>
          <span id={hintId} className="text-2xl text-ink-muted">
            {hint} 이하
          </span>
        </label>
      </div>
      <p className="mt-8 text-2xl text-ink-muted">
        파일 창 대신 영상 파일을 이 상자 위로 끌어다 놓아도 돼요.
      </p>

      <StatusDialog
        open={rejection != null}
        kicker="업로드 불가"
        tone="danger"
        title={rejection?.reason ?? ''}
        primaryLabel="다른 파일 고르기"
        onPrimary={() => {
          setRejection(null)
          inputRef.current?.click()
        }}
        secondaryLabel="취소"
        onSecondary={() => setRejection(null)}
      >
        {rejection && <p className="font-bold">{rejection.action}</p>}
      </StatusDialog>
    </div>
  )
}
