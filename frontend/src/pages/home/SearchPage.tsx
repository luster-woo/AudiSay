import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { videosApi } from '@/api/videos'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import { ApiError } from '@/api/errors'
import type { YoutubeSearchItem } from '@/api/types'
import { Notice } from '@/components/ui/Notice'
import { Pagination } from '@/components/ui/Pagination'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { HomeTop } from '@/features/search/HomeTop'
import { VideoCard } from '@/features/video/VideoCard'
import { youtubeShortUrl } from '@/utils/youtube'

const PAGE_SIZE = 4

/** 검색어가 길면 앞쪽 단어만 남긴 예시 ('삼각함수 그래프 이동 공식' → '삼각함수 그래프') */
function shorterExample(q: string) {
  const words = q.trim().split(/\s+/)
  return words.length > 2 ? words.slice(0, 2).join(' ') : words[0]
}

/**
 * 카드 하나 = 링크 하나 (버튼 없음).
 * - 해설 있음 → 시청 화면
 * - 그 밖에는 주소 확인 화면으로. 거기서 '해설 만들기'(횟수 차감)를 따로 누르거나, 만들 수 없는 이유를 듣는다.
 * 지금 등급의 최대 길이를 넘는 영상은 카드 이름에 '만들 수 없음'과 이유를 미리 넣는다.
 */
function cardOf(item: YoutubeSearchItem, maxSec: number | null) {
  if (item.hasDescription && item.videoId != null) {
    return { to: `/watch/${item.videoId}`, status: '해설 있음', tone: 'normal' as const }
  }
  const to = `/search/youtube?url=${encodeURIComponent(youtubeShortUrl(item.youtubeVideoId))}`
  if (maxSec != null && item.durationSec > maxSec) {
    return {
      to,
      status: `해설 만들 수 없음, ${Math.floor(maxSec / 60)}분 넘음`,
      tone: 'danger' as const,
    }
  }
  return { to, status: '해설 만들 수 있어요', tone: 'normal' as const }
}

/** 검색 결과 (/search?q=) — 유튜브 검색, 해설 있는 영상이 먼저 */
export default function SearchPage() {
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  return <SearchResults key={q} q={q} />
}

function SearchResults({ q }: { q: string }) {
  const { announce } = useAnnouncer()
  const searchRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [page, setPage] = useState(0)

  const { data: quota } = useQuery({ queryKey: queryKeys.quota, queryFn: usersApi.quota })
  const result = useInfiniteQuery({
    queryKey: queryKeys.youtubeSearch(q),
    queryFn: ({ pageParam }) => videosApi.youtubeSearch(q, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last?.nextPageToken ?? undefined,
    enabled: q.length > 0,
  })

  const items = result.data?.pages.flatMap((p) => p.items) ?? []
  const described = items.filter((i) => i.hasDescription).length
  const unavailable = result.error instanceof ApiError && result.error.code === 'VIDEO_008'
  const empty = result.isSuccess && items.length === 0
  const settled = !q || result.isSuccess || result.isError

  usePageEntry({
    title: q ? `"${q}" 검색 결과` : '검색',
    announce: unavailable
      ? '지금은 검색을 쓸 수 없어요. 유튜브 주소를 붙여 넣어 주세요. 검색 칸에 있어요.'
      : result.isError
        ? '검색하지 못했어요. 잠시 뒤에 다시 시도해 주세요. 검색 칸에 있어요.'
        : !q || empty
          ? `"${q}" 검색 결과가 없어요. 검색 칸에 있어요.`
          : `"${q}" 검색 결과 ${items.length}개. ${
              described > 0
                ? `해설 있는 영상 ${described}개가 먼저 나와요.`
                : '해설 있는 영상은 없어요.'
            }`,
    focusRef: !q || empty || result.isError ? searchRef : headingRef,
    ready: settled,
  })

  const maxSec = quota?.youtube.maxDurationSec ?? null
  const start = page * PAGE_SIZE
  const visible = items.slice(start, start + PAGE_SIZE)
  const hasMoreLoaded = start + PAGE_SIZE < items.length

  const changePage = async (next: number) => {
    if (next > page && !hasMoreLoaded && result.hasNextPage) await result.fetchNextPage()
    setPage(next)
    headingRef.current?.focus()
    announce(`${next * PAGE_SIZE + 1}번째 영상부터 보여 줘요.`)
  }

  return (
    <div>
      <HomeTop defaultValue={q} inputRef={searchRef} />

      <section aria-labelledby="search-result" className="mt-6">
        {unavailable && (
          <Notice title="지금은 검색을 쓸 수 없어요">
            유튜브 주소를 붙여 넣으면 바로 확인할 수 있어요.
          </Notice>
        )}

        {(empty || !q) && (
          <>
            <h2 id="search-result" className="text-[1.75rem] font-bold">
              찾는 영상이 없어요
            </h2>
            {q && (
              <div className="mt-8 space-y-3 text-xl">
                <p>검색어를 짧게 바꾸거나 띄어쓰기를 확인해 주세요.</p>
                <p>예: ‘{shorterExample(q)}’</p>
              </div>
            )}
          </>
        )}

        {items.length > 0 && (
          <>
            {/* 홈의 제목 줄(카테고리 select 높이)과 같은 높이로 맞춰 카드 시작 위치를 통일한다 */}
            <div className="flex min-h-touch items-center justify-between gap-4">
              <h2
                id="search-result"
                ref={headingRef}
                tabIndex={-1}
                className="text-[1.75rem] font-bold outline-none"
              >
                검색 결과
              </h2>
              <p className="text-xl">
                전체 {items.length}
                {result.hasNextPage ? '개 넘게' : '개'}
              </p>
            </div>
            <ul className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {visible.map((item) => (
                <li key={item.youtubeVideoId}>
                  <VideoCard
                    title={item.title}
                    channelTitle={item.channelTitle}
                    durationSec={item.durationSec}
                    thumbnailUrl={item.thumbnailUrl}
                    {...cardOf(item, maxSec)}
                  />
                </li>
              ))}
            </ul>
            <Pagination
              page={{
                number: page,
                size: PAGE_SIZE,
                totalElements: items.length,
                totalPages: Math.ceil(items.length / PAGE_SIZE),
                first: page === 0,
                last: !hasMoreLoaded && !result.hasNextPage,
              }}
              onChange={(n) => void changePage(n)}
              size="xl"
              className="mt-6"
            />
          </>
        )}
      </section>
    </div>
  )
}
