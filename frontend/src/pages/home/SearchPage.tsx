import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { videosApi } from '@/api/videos'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import { ApiError } from '@/api/errors'
import type { YoutubeSearchItem } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { HomeTop } from '@/features/search/HomeTop'
import { VideoListRow } from '@/features/video/VideoListRow'
import { youtubeShortUrl } from '@/utils/youtube'

/** 한 번에 더 보여 줄 개수. 홈의 '더 보기' 단위와 같다 (한 번에 듣기 알맞은 양) */
const STEP = 10

/** 검색어가 길면 앞쪽 단어만 남긴 예시 ('삼각함수 그래프 이동 공식' → '삼각함수 그래프') */
function shorterExample(q: string) {
  const words = q.trim().split(/\s+/)
  return words.length > 2 ? words.slice(0, 2).join(' ') : words[0]
}

/**
 * 줄 하나 = 링크 하나 (버튼 없음). 홈과 같은 한 열 목록(VideoListRow)이다.
 * - 해설 있음 → 시청 화면
 * - 그 밖에는 주소 확인 화면으로. 거기서 '해설 만들기'(횟수 차감)를 따로 누르거나, 만들 수 없는 이유를 듣는다.
 * 지금 등급의 최대 길이를 넘는 영상은 줄 상태에 '만들 수 없음'과 이유를 미리 넣는다 (설명으로 이어 읽힌다).
 */
function rowOf(item: YoutubeSearchItem, maxSec: number | null) {
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

/**
 * 검색 결과 (/search?q=) — 유튜브 검색, 해설 있는 영상이 먼저.
 * 홈처럼 한 열 목록으로 10개씩 보여 주고 '더 보기'로 이어 붙인다.
 * - 더 보기 뒤에는 새로 붙은 첫 영상으로 포커스를 옮기고, 몇 개 불러왔는지 알린다
 * - 보여 준 개수는 주소(?shown=)에 남겨, 영상을 보고 뒤로 오면 그대로 돌아온다
 */
export default function SearchPage() {
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  return <SearchResults key={q} q={q} />
}

function SearchResults({ q }: { q: string }) {
  const { announce } = useAnnouncer()
  const searchRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const [params, setParams] = useSearchParams()
  const requested = Number(params.get('shown') ?? STEP)
  const shown = Number.isSafeInteger(requested) && requested >= STEP ? requested : STEP
  const [loadingMore, setLoadingMore] = useState(false)

  const { data: quota } = useQuery({ queryKey: queryKeys.quota, queryFn: usersApi.quota })
  const result = useInfiniteQuery({
    queryKey: queryKeys.youtubeSearch(q),
    queryFn: ({ pageParam }) => videosApi.youtubeSearch(q, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last?.nextPageToken ?? undefined,
    enabled: q.length > 0,
  })

  const items = result.data?.pages.flatMap((p) => p.items) ?? []
  // 진입 안내의 개수는 첫 쪽 기준으로 고정한다. 더 보기로 쪽이 늘어도 다시 읽거나 포커스를 되돌리지 않게
  const firstPage = result.data?.pages[0]?.items ?? []
  const described = firstPage.filter((i) => i.hasDescription).length
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
          : `"${q}" 검색 결과 ${firstPage.length}개. ${
              described > 0
                ? `해설 있는 영상 ${described}개가 먼저 나와요.`
                : '해설 있는 영상은 없어요.'
            }`,
    focusRef: !q || empty || result.isError ? searchRef : headingRef,
    ready: settled,
  })

  const maxSec = quota?.youtube.maxDurationSec ?? null
  const visible = items.slice(0, shown)
  // 유튜브는 전체 개수를 주지 않는다. 다음 쪽이 더 있으면 '넘게'로만 말한다
  const more = visible.length < items.length || result.hasNextPage
  const remaining = result.hasNextPage ? null : items.length - visible.length

  // 더 보기: 아직 안 받은 쪽이 필요하면 먼저 받아 온 뒤, 새로 붙을 첫 영상 순번을 기억했다가 그 영상으로 포커스를 옮긴다
  const focusFrom = useRef<number | null>(null)
  const loadMore = async () => {
    if (loadingMore) return
    const from = visible.length
    if (from + STEP > items.length && result.hasNextPage) {
      setLoadingMore(true)
      try {
        const next = await result.fetchNextPage()
        if (next.isError) {
          announce('더 불러오지 못했어요. 잠시 뒤에 다시 시도해 주세요.')
          return
        }
      } finally {
        setLoadingMore(false)
      }
    }
    focusFrom.current = from
    const p = new URLSearchParams(params)
    p.set('shown', String(from + STEP))
    // 쌓지 않고 바꾼다: 뒤로 가기는 이전 화면으로, 다시 오면 이 상태로
    setParams(p, { replace: true, preventScrollReset: true })
  }
  const visibleCount = visible.length
  const loadedCount = items.length
  const hasNextPage = result.hasNextPage
  useEffect(() => {
    const from = focusFrom.current
    // 주소의 shown 이 늘어난 그리기에서만 움직인다 (받아 온 직후, shown 이 아직 안 바뀐 그리기는 건너뛴다)
    if (from === null || shown <= from) return
    focusFrom.current = null
    const added = visibleCount - from
    if (added <= 0) {
      announce('더 불러올 영상이 없어요.')
      return
    }
    listRef.current?.querySelectorAll<HTMLAnchorElement>(':scope > li > a')[from]?.focus()
    const done = visibleCount >= loadedCount && !hasNextPage
    announce(
      `${added}개 더 불러왔어요. ${visibleCount}개까지 보여 줘요.${done ? ' 모든 영상을 불러왔어요.' : ''}`,
    )
  }, [shown, visibleCount, loadedCount, hasNextPage, announce])

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
            {/* 홈의 제목 줄(카테고리 select 높이)과 같은 높이로 맞춰 목록 시작 위치를 통일한다 */}
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
            {/* 홈과 같은 한 열 목록. 줄 전체가 링크 하나, 이름은 제목, 출처·길이·상태는 설명으로 이어 읽힌다 */}
            <ol ref={listRef} className="mt-6 space-y-3">
              {visible.map((item) => (
                <li key={item.youtubeVideoId}>
                  <VideoListRow
                    title={item.title}
                    source={`유튜브 · ${item.channelTitle}`}
                    durationSec={item.durationSec}
                    thumbnailUrl={item.thumbnailUrl}
                    {...rowOf(item, maxSec)}
                  />
                </li>
              ))}
            </ol>
            {more && (
              <Button
                variant="secondary"
                size="xl"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="mt-4 w-full"
              >
                {loadingMore
                  ? '불러오는 중'
                  : remaining == null
                    ? '더 보기'
                    : `더 보기 (${remaining}개 남음)`}
              </Button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
