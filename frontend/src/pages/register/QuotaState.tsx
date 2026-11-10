import { useRef } from 'react'
import { usePageEntry } from '@/features/page/usePageEntry'
import { ListError } from '@/features/video/ListError'

/** 영상 올리기 첫 화면: 오늘 남은 횟수를 받는 중이거나 받지 못했을 때 */
export function QuotaState({
  loading,
  error,
  retrying,
  onRetry,
}: {
  loading: boolean
  error: unknown
  retrying: boolean
  onRetry: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  usePageEntry({
    title: '영상 올리기',
    announce: loading ? '영상 올리기예요. 오늘 남은 횟수를 불러오는 중이에요.' : '영상 올리기예요.',
    focusRef: headingRef,
  })
  return (
    <div className="max-w-[60rem]">
      <p className="text-2xl font-bold text-navy">영상 올리기</p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-[2.75rem] font-bold outline-none">
        {loading ? '불러오는 중이에요' : '횟수를 불러오지 못했어요'}
      </h1>
      {!loading && (
        <ListError
          title="오늘 남은 횟수를 불러오지 못했어요"
          error={error}
          retrying={retrying}
          onRetry={onRetry}
        />
      )}
    </div>
  )
}
