import { useState, type RefObject } from 'react'
import { useAnnouncer } from '@/features/announcer/context'
import { checkFile, readVideoDuration, type Limits, type Rejection } from './fileRules'
import { StatusDialog } from './StatusDialog'

export interface PickedFile {
  file: File
  durationSec: number
}

/**
 * 고른 파일 검사 (길이·크기·형식). 1단계와 2단계의 '수정하기'가 같이 쓴다.
 * 올릴 수 없으면 알림창을 띄우고, '다른 파일 고르기'는 inputRef 의 파일 창을 다시 연다.
 */
export function useFileCheck({
  limits,
  disabled = false,
  inputRef,
  onPicked,
}: {
  limits: Limits
  disabled?: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onPicked: (picked: PickedFile) => void
}) {
  const { announce } = useAnnouncer()
  const [checking, setChecking] = useState(false)
  const [rejection, setRejection] = useState<Rejection | null>(null)

  const take = async (file: File | undefined) => {
    if (!file || disabled) return
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

  const rejectionDialog = (
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
  )

  return { checking, take, rejectionDialog }
}
