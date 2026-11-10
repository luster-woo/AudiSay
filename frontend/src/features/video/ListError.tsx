import { useEffect } from 'react'
import { toUserMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { useAnnouncer } from '@/features/announcer/context'

/**
 * 목록을 불러오지 못했을 때의 상자: 제목 + 이유 + '다시 불러오기', 그리고 한 번 급히 알린다.
 * 홈·검색·내 영상이 같은 모양으로 쓴다 (화면마다 오류 처리가 달라 어떤 화면은 복구 방법이 없었다)
 */
export function ListError({
  title,
  error,
  retryLabel = '다시 불러오기',
  retrying,
  onRetry,
  announceText,
  className,
}: {
  title: string
  error: unknown
  retryLabel?: string
  retrying: boolean
  onRetry: () => void
  /** 처음 보일 때 읽을 문장. 없으면 '제목. 이유'. null 이면 읽지 않는다(화면 진입 안내가 이미 이유를 읽을 때) */
  announceText?: string | null
  className?: string
}) {
  const { announce } = useAnnouncer()
  const reason = toUserMessage(error)
  const spoken = announceText === undefined ? `${title}. ${reason}` : announceText
  useEffect(() => {
    if (spoken) announce(spoken, { politeness: 'assertive' })
  }, [spoken, announce])
  return (
    <div className={cn('mt-6 rounded-lg border-2 border-line bg-paper p-6', className)}>
      <p className="text-2xl font-bold">{title}</p>
      <p className="mt-2 text-xl">{reason}</p>
      <Button className="mt-5" variant="secondary" loading={retrying} onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  )
}
