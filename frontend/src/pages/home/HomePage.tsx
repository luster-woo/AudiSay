import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { videosApi } from '@/api/videos'
import { queryKeys } from '@/api/queryKeys'
import type { VideoCategory } from '@/api/types'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { HomeTop } from '@/features/search/HomeTop'
import { CATEGORY_LABELS, CATEGORY_OPTIONS } from '@/features/video/categories'
import { VideoCard } from '@/features/video/VideoCard'

const PAGE_SIZE = 4

/** 홈: 검색 + 해설이 준비된 영상 (GET /videos) */
export default function HomePage() {
  const { announce } = useAnnouncer()
  const searchRef = useRef<HTMLInputElement>(null)
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const [category, setCategory] = useState<VideoCategory | ''>('')
  const [page, setPage] = useState(0)

  const params = { category: category || undefined, page, size: PAGE_SIZE }
  const { data, isPlaceholderData, isError } = useQuery({
    queryKey: queryKeys.videos(params),
    queryFn: () => videosApi.list(params),
    placeholderData: keepPreviousData,
  })

  // 진입 안내의 개수는 '전체' 첫 페이지 기준 (카테고리를 바꿔도 다시 읽지 않게 따로 둔다)
  const firstPage = { page: 0, size: PAGE_SIZE }
  const { data: all, isFetched } = useQuery({
    queryKey: queryKeys.videos(firstPage),
    queryFn: () => videosApi.list(firstPage),
  })
  usePageEntry({
    title: '홈',
    announce: all
      ? `홈이에요. 검색 칸에 있어요. 해설이 준비된 영상 ${all.page.totalElements}개.`
      : '홈이에요. 검색 칸에 있어요.',
    focusRef: searchRef,
    ready: isFetched,
  })

  const changePage = (next: number) => {
    setPage(next)
    listHeadingRef.current?.focus()
    const start = next * PAGE_SIZE + 1
    announce(`${start}번째 영상부터 보여 줘요.`)
  }

  const changeCategory = (value: string) => {
    setCategory(value as VideoCategory | '')
    setPage(0)
  }

  // 카테고리를 바꾼 뒤 개수를 한 번 읽어 준다 (포커스는 select 에 그대로 둔다)
  const announcedCategory = useRef<string>('')
  const total = isPlaceholderData ? undefined : data?.page.totalElements
  useEffect(() => {
    if (total === undefined || announcedCategory.current === category) return
    announcedCategory.current = category
    announce(`${category ? CATEGORY_LABELS[category] : '전체'} 영상 ${total}개.`)
  }, [category, total, announce])

  return (
    <div>
      <HomeTop inputRef={searchRef} />

      <section aria-labelledby="ready-videos" className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2
            id="ready-videos"
            ref={listHeadingRef}
            tabIndex={-1}
            className="text-[1.75rem] font-bold outline-none"
          >
            해설이 준비된 영상
          </h2>
          <div className="flex items-center gap-4">
            {data && <p className="text-xl">{data.page.totalElements}개</p>}
            <Select
              label="카테고리"
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={(e) => changeCategory(e.target.value)}
              className="[&_label]:text-xl [&_select]:min-w-44"
            />
          </div>
        </div>

        {isError && <p className="mt-6 text-xl">영상 목록을 불러오지 못했어요.</p>}
        {data && data.content.length === 0 && (
          <p className="mt-6 text-xl">아직 이 카테고리에는 해설이 준비된 영상이 없어요.</p>
        )}

        {data && data.content.length > 0 && (
          <>
            <ul className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {data.content.map((v) => (
                <li key={v.videoId}>
                  <VideoCard
                    title={v.title}
                    channelTitle={v.channelTitle}
                    durationSec={v.durationSec}
                    thumbnailUrl={v.thumbnailUrl}
                    to={`/watch/${v.videoId}`}
                  />
                </li>
              ))}
            </ul>
            <Pagination page={data.page} onChange={changePage} size="xl" className="mt-6" />
          </>
        )}
      </section>
    </div>
  )
}
