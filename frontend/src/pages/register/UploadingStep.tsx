import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { JobSteps } from '@/features/job/JobSteps'
import { uploadOverallPercent, uploadSteps } from '@/features/job/stages'
import { formatSize } from '@/features/upload/fileRules'
import { StatusDialog } from '@/features/upload/StatusDialog'
import type { UploadPhase } from '@/features/upload/useVideoUpload'

function remainText(etaSec: number | null) {
  if (etaSec == null) return '남은 시간을 계산하고 있어요'
  if (etaSec < 60) return '1분 안에 끝나요'
  return `약 ${Math.round(etaSec / 60)}분 남았어요`
}

/**
 * 올리는 중: 해설 만들기 전체 진행률 + 단계 목록(영상 업로드 진행 중) + 업로드 멈추기.
 * 전체 진행률에서 업로드는 앞 15%다(features/job/stages). 다 올리면 RegisterPage 가 /jobs/:id 로 넘긴다.
 * 연결이 끊기면 '업로드 멈춤' 창.
 */
export function UploadingStep({
  title,
  totalBytes,
  loaded,
  etaSec,
  phase,
  onStop,
  onRestart,
  onGiveUp,
}: {
  title: string
  totalBytes: number
  loaded: number
  etaSec: number | null
  phase: UploadPhase
  onStop: () => void
  onRestart: () => void
  onGiveUp: () => void
}) {
  const { announce } = useAnnouncer()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const percent =
    phase === 'done' ? 100 : totalBytes ? Math.min(100, Math.floor((loaded / totalBytes) * 100)) : 0
  const finished = phase === 'completing' || phase === 'done'
  const remain = finished ? '다 올렸어요' : remainText(etaSec)
  const overall = uploadOverallPercent(percent)
  const steps = uploadSteps(phase === 'failed' ? 'failed' : finished ? 'done' : 'active')

  usePageEntry({
    title: '영상 올리는 중',
    announce: '영상을 올리기 시작했어요. 올리는 동안 이 화면에 머물러 주세요.',
    focusRef: headingRef,
  })

  // 10% 단위로만 읽는다 (원칙 8장). 0% 는 진입 안내가 대신한다
  const lastBucket = useRef(0)
  useEffect(() => {
    const bucket = Math.floor(percent / 10)
    if (bucket <= lastBucket.current || percent >= 100) return
    lastBucket.current = bucket
    announce(
      `영상 업로드 중이에요, ${bucket * 10}퍼센트 올렸어요. 전체 ${uploadOverallPercent(bucket * 10)}퍼센트. ${remain}.`,
    )
  }, [percent, remain, announce])

  useEffect(() => {
    if (phase === 'completing') announce('영상을 다 올렸어요. 해설 만들기를 시작하고 있어요.')
    if (phase === 'failed') {
      announce('연결이 끊겨 업로드가 멈췄어요. 처음부터 다시 올리기 버튼에 있어요.', {
        politeness: 'assertive',
      })
    }
  }, [phase, announce])

  return (
    <div className="max-w-[60rem]">
      <p className="text-2xl font-bold text-navy">해설 만들기</p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-[2.75rem] font-bold outline-none">
        {phase === 'completing' || phase === 'done' ? '다 올렸어요' : '영상을 올리고 있어요'}
      </h1>
      <p className="mt-6 text-2xl">
        {title} · {formatSize(totalBytes)}
      </p>
      <p aria-hidden="true" className="mt-6 text-[6rem] leading-none font-bold">
        {overall}%
      </p>
      <ProgressBar
        value={overall}
        label="해설 만들기 진행률"
        valueText={`전체 ${overall}퍼센트, 영상 업로드 ${percent}퍼센트, ${remain}`}
        className="mt-10 h-7"
      />
      <p className="mt-6 text-2xl text-ink-muted">
        영상 업로드 {percent}% · {formatSize(finished ? totalBytes : loaded)} /{' '}
        {formatSize(totalBytes)} · {remain}
      </p>
      <JobSteps steps={steps} className="mt-10" />
      <p className="mt-8 text-2xl">
        {finished
          ? '해설 만들기를 시작하고 있어요.'
          : '다 올라가면 해설 만들기가 바로 시작돼요. 올리는 동안 이 화면에 머물러 주세요.'}
      </p>
      {!finished && (
        <Button
          variant="secondary"
          size="2xl"
          disabled={phase !== 'uploading'}
          // 창이 열리며 창 이름('업로드를 멈출까요?')과 처음 포커스('계속 올리기')를 읽는다. 안내로 또 읽지 않는다
          onClick={() => setConfirmStop(true)}
          className="mt-8 min-w-[14rem]"
        >
          업로드 멈추기
        </Button>
      )}

      <StatusDialog
        open={confirmStop && phase === 'uploading'}
        kicker="확인"
        tone="info"
        title="업로드를 멈출까요?"
        primaryLabel="계속 올리기"
        onPrimary={() => setConfirmStop(false)}
        secondaryLabel="멈추기"
        onSecondary={() => {
          setConfirmStop(false)
          onStop()
        }}
        onEscape={() => setConfirmStop(false)}
      >
        <p>멈추면 지금까지 올린 부분은 지워져요.</p>
        <p>오늘 횟수는 쓰지 않아요.</p>
      </StatusDialog>

      <StatusDialog
        open={phase === 'failed'}
        kicker="업로드 멈춤"
        tone="danger"
        title="연결이 끊겨 업로드가 멈췄어요"
        primaryLabel="처음부터 다시 올리기"
        onPrimary={() => {
          setConfirmStop(false)
          onRestart()
        }}
        secondaryLabel="업로드 취소"
        onSecondary={onGiveUp}
        // 끊김 안내는 사용자가 고를 때까지 닫지 않는다 (원칙 8장)
        onEscape={() => undefined}
      >
        <p>올리던 파일은 저장되지 않았어요. 처음부터 다시 올려야 해요.</p>
        <p>오늘 횟수는 쓰지 않았어요.</p>
      </StatusDialog>
    </div>
  )
}
