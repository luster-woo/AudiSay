import { useState } from 'react'
import { useBlocker, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import { toUserMessage } from '@/api/errors'
import type { Visibility } from '@/api/types'
import { useAnnouncer } from '@/features/announcer/context'
import { titleFromFileName } from '@/features/upload/fileRules'
import { StatusDialog } from '@/features/upload/StatusDialog'
import { useVideoUpload } from '@/features/upload/useVideoUpload'
import { PickStep, type PickedFile } from './PickStep'
import { TitleStep } from './TitleStep'
import { UploadingStep } from './UploadingStep'
import { VisibilityStep } from './VisibilityStep'

type Step = 'pick' | 'title' | 'visibility' | 'uploading'

/**
 * 영상 등록 (/register). 파일 고르기 → 제목 → 공개 범위 → 올리는 중 → 해설 만들기(/jobs/:id).
 * 고른 파일(File)은 새로고침하면 사라지므로 단계를 주소로 나누지 않고 한 화면에서 바꾼다.
 */
export default function RegisterPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { announce } = useAnnouncer()
  const [step, setStep] = useState<Step>('pick')
  const [picked, setPicked] = useState<PickedFile | null>(null)
  const [title, setTitle] = useState('')
  const [submitError, setSubmitError] = useState<string>()

  const { data: quota, isFetched } = useQuery({
    queryKey: queryKeys.quota,
    queryFn: usersApi.quota,
  })

  const upload = useVideoUpload((result) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.quota })
    void queryClient.invalidateQueries({ queryKey: ['me', 'videos'] })
    navigate(`/jobs/${result.jobId}`, { replace: true })
  })

  // 올리는 중에 다른 메뉴로 가려 하면 먼저 묻는다 (원칙 8장). 새로고침·창 닫기는 useVideoUpload 가 막는다
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      upload.phase === 'uploading' && currentLocation.pathname !== nextLocation.pathname,
  )

  const backToPick = (message: string) => {
    setStep('pick')
    setPicked(null)
    // 새 화면의 진입 안내 뒤에 결과를 이어서 읽는다
    setTimeout(() => announce(message), 300)
  }

  const start = async (visibility: Visibility) => {
    if (!picked) return
    setSubmitError(undefined)
    try {
      await upload.begin({ ...picked, title, visibility })
      setStep('uploading')
    } catch (err) {
      setSubmitError(toUserMessage(err))
      announce(`올리기를 시작하지 못했어요. ${toUserMessage(err)}`, { politeness: 'assertive' })
    }
  }

  if (!isFetched) return <p className="text-2xl">불러오는 중이에요.</p>

  const remaining = quota?.upload.remaining ?? null
  const limits = {
    maxDurationSec: quota?.upload.maxDurationSec ?? null,
    maxSizeBytes: quota?.upload.maxSizeBytes ?? null,
  }

  const leaveDialog = (
    <StatusDialog
      open={blocker.state === 'blocked'}
      kicker="확인"
      tone="info"
      title="업로드를 멈추고 나갈까요?"
      primaryLabel="계속 올리기"
      onPrimary={() => blocker.reset?.()}
      secondaryLabel="멈추고 나가기"
      onSecondary={() => void upload.stop().then(() => blocker.proceed?.())}
      onEscape={() => blocker.reset?.()}
    >
      <p>나가면 지금까지 올린 부분은 지워져요.</p>
      <p>오늘 횟수는 쓰지 않아요.</p>
    </StatusDialog>
  )

  switch (step) {
    case 'pick':
      return (
        <PickStep
          limits={limits}
          remaining={remaining}
          onPicked={(p) => {
            setPicked(p)
            setTitle(titleFromFileName(p.file.name))
            setStep('title')
          }}
        />
      )
    case 'title':
      return picked ? (
        <TitleStep
          picked={picked}
          defaultTitle={title}
          onNext={(t) => {
            setTitle(t)
            setStep('visibility')
          }}
        />
      ) : null
    case 'visibility':
      return (
        <VisibilityStep
          remaining={remaining}
          submitting={upload.phase === 'starting'}
          submitError={submitError}
          onSubmit={(v) => void start(v)}
        />
      )
    case 'uploading':
      return picked ? (
        <>
          {leaveDialog}
          <UploadingStep
            title={title}
            totalBytes={picked.file.size}
            loaded={upload.loaded}
            etaSec={upload.etaSec}
            phase={upload.phase}
            onStop={() =>
              void upload
                .stop()
                .then(() => backToPick('업로드를 멈췄어요. 오늘 횟수는 쓰지 않았어요.'))
            }
            onRestart={() =>
              void upload.restart().catch((err) => {
                setStep('visibility')
                setSubmitError(toUserMessage(err))
              })
            }
            onGiveUp={() =>
              void upload
                .stop()
                .then(() => backToPick('업로드를 취소했어요. 오늘 횟수는 쓰지 않았어요.'))
            }
          />
        </>
      ) : null
  }
}
