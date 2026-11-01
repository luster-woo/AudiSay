import type { RefObject } from 'react'
import { JobProgressCard } from './JobProgressCard'
import { SearchBar } from './SearchBar'

/** 홈·검색 결과 공통 위쪽: 제목 + 검색 줄 + (있으면) 만드는 중인 해설 카드 */
export function HomeTop({
  defaultValue,
  inputRef,
}: {
  defaultValue?: string
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="grid gap-8 border-b-2 border-line pb-6 lg:grid-cols-[minmax(0,55rem)_19.375rem] lg:justify-between">
      <div>
        <h1 className="text-4xl font-bold">어떤 영상을 볼까요?</h1>
        <div className="mt-1">
          <SearchBar defaultValue={defaultValue} inputRef={inputRef} />
        </div>
      </div>
      <JobProgressCard />
    </div>
  )
}
