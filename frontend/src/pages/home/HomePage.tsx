import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { videosApi } from '@/api/videos'
import { queryKeys } from '@/api/queryKeys'
import type { Paged, VideoCategory, VideoSummary } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { HomeTop } from '@/features/search/HomeTop'
import { CATEGORY_LABELS, CATEGORY_OPTIONS } from '@/features/video/categories'
import { VideoListRow } from '@/features/video/VideoListRow'

/** 한 번에 더 보여 줄 개수. 줄마다 정보가 3~4개라 한 번에 듣기 알맞은 양 */
const STEP = 10
/** 서버가 한 번에 주는 최대 개수 (PageParams size 최대 50) */
const MAX_SIZE = 50

/**
 * 앞에서부터 shown 개를 받는다. 50개를 넘으면 50개씩 나눠 받아 잇는다.
 * 늘 첫 쪽부터 다시 받으므로, 그 사이 새 해설이 올라와도 빠지는 영상이 없고 videoId 로 중복만 거른다
 */
async function fetchShown(
  category: VideoCategory | '',
  shown: number,
): Promise<Paged<VideoSummary>> {
  const chunks = Math.max(1, Math.ceil(shown / MAX_SIZE))
  const size = chunks === 1 ? shown : MAX_SIZE
  const pages = await Promise.all(
    Array.from({ length: chunks }, (_, page) =>
      videosApi.list({ category: category || undefined, page, size }),
    ),
  )
  const seen = new Set<number>()
  const content = pages
    .flatMap((p) => p.content)
    .filter((v) => !seen.has(v.videoId) && seen.add(v.videoId))
    .slice(0, shown)
  return { content, page: pages[pages.length - 1].page }
}

/**
 * 홈: 검색 + 해설이 준비된 영상 (GET /videos).
 * 한 열 목록(ol)으로 10개씩 보여 주고 '더 보기'로 이어 붙인다.
 * - 더 보기 뒤에는 새로 붙은 첫 영상으로 포커스를 옮기고, 몇 개 불러왔는지·전체 몇 개인지 알린다
 * - 불러온 개수와 카테고리는 주소(?shown=&category=)에 남겨, 영상을 보고 뒤로 오면 그대로 돌아온다
 * - 다 불러오면 알리고 버튼을 없앤다
 */
export default function HomePage() {
  const { announce } = useAnnouncer()
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const [params, setParams] = useSearchParams()
  const category = (params.get('category') ?? '') as VideoCategory | ''
  const requested = Number(params.get('shown') ?? STEP)
  const shown = Number.isSafeInteger(requested) && requested >= STEP ? requested : STEP

  const { data, isPlaceholderData, isError } = useQuery({
    queryKey: queryKeys.videos({ home: true, category, shown }),
    queryFn: () => fetchShown(category, shown),
    placeholderData: keepPreviousData,
  })

  // 진입 안내의 개수는 '전체' 기준 (카테고리를 바꿔도 다시 읽지 않게 따로 둔다)
  const totalQuery = { page: 0, size: 1 }
  const { data: all, isFetched } = useQuery({
    queryKey: queryKeys.videos(totalQuery),
    queryFn: () => videosApi.list(totalQuery),
  })
  usePageEntry({
    title: '홈',
    announce: all
      ? `홈이에요. 검색 칸에 있어요. 해설이 준비된 영상 ${all.page.totalElements}개.`
      : '홈이에요. 검색 칸에 있어요.',
    focusRef: searchRef,
    ready: isFetched,
  })

  const update = (next: { category?: VideoCategory | ''; shown?: number }) => {
    const p = new URLSearchParams(params)
    const c = next.category ?? category
    const n = next.shown ?? shown
    if (c) p.set('category', c)
    else p.delete('category')
    if (n > STEP) p.set('shown', String(n))
    else p.delete('shown')
    // 쌓지 않고 바꾼다: 뒤로 가기는 이전 화면으로, 다시 오면 이 상태로
    setParams(p, { replace: true, preventScrollReset: true })
  }

  // 더 보기: 새로 붙을 첫 영상 순번을 기억했다가, 받아 온 뒤 그 영상으로 포커스를 옮긴다
  const focusFrom = useRef<number | null>(null)
  const loadMore = () => {
    if (!data || isPlaceholderData) return
    focusFrom.current = data.content.length
    update({ shown: shown + STEP })
  }
  const items = data?.content ?? []
  const total = data?.page.totalElements ?? 0
  useEffect(() => {
    const from = focusFrom.current
    if (from === null || isPlaceholderData || !data) return
    focusFrom.current = null
    const added = data.content.length - from
    if (added <= 0) {
      announce('더 불러올 영상이 없어요.')
      return
    }
    listRef.current?.querySelectorAll<HTMLAnchorElement>(':scope > li > a')[from]?.focus()
    const done = data.content.length >= data.page.totalElements
    announce(
      `${added}개 더 불러왔어요. 전체 ${data.page.totalElements}개 중 ${data.content.length}개.${done ? ' 모든 영상을 불러왔어요.' : ''}`,
    )
  }, [data, isPlaceholderData, announce])

  const changeCategory = (value: string) => {
    focusFrom.current = null
    update({ category: value as VideoCategory | '', shown: STEP })
  }

  // 카테고리를 바꾼 뒤 개수를 한 번 읽어 준다 (포커스는 select 에 그대로 둔다)
  const announcedCategory = useRef<string>(category)
  const settledTotal = isPlaceholderData ? undefined : data?.page.totalElements
  useEffect(() => {
    if (settledTotal === undefined || announcedCategory.current === category) return
    announcedCategory.current = category
    announce(`${category ? CATEGORY_LABELS[category] : '전체'} 영상 ${settledTotal}개.`)
  }, [category, settledTotal, announce])

  const remaining = Math.max(0, total - items.length)
  // 더 보기·카테고리를 바꾸는 동안은 이전 목록을 둔 채 받아 온다 (keepPreviousData)
  const loadingMore = isPlaceholderData

  return (
    <div>
      <HomeTop inputRef={searchRef} />

      <section aria-labelledby="ready-videos" className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="ready-videos" className="text-[1.75rem] font-bold">
            해설이 준비된 영상
            {/* 개수는 제목 옆에 작게. 진입 안내에서 이미 읽어 주므로 제목 이름에는 넣지 않는다 */}
            {data && (
              <span aria-hidden="true" className="ml-3 text-xl font-normal text-ink-muted">
                {data.page.totalElements}개
              </span>
            )}
          </h2>
          <div className="flex items-center gap-4">
            <Select
              label="카테고리"
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={(e) => changeCategory(e.target.value)}
              className="[&_label]:text-xl [&_select]:min-w-44 [&_select]:text-xl"
            />
          </div>
        </div>

        {isError && <p className="mt-6 text-xl">영상 목록을 불러오지 못했어요.</p>}
        {data && items.length === 0 && (
          <p className="mt-6 text-xl">아직 이 카테고리에는 해설이 준비된 영상이 없어요.</p>
        )}

        {items.length > 0 && (
          <>
            <ol ref={listRef} className="mt-6 space-y-3">
              {items.map((v) => (
                <li key={v.videoId}>
                  <VideoListRow
                    title={v.title}
                    // 출처를 붙여 화면과 낭독기 모두 유튜브 영상·직접 올린 영상을 구분하게 한다
                    source={
                      v.sourceType === 'UPLOAD' ? '직접 올린 영상' : `유튜브 · ${v.channelTitle}`
                    }
                    durationSec={v.durationSec}
                    thumbnailUrl={v.thumbnailUrl}
                    to={`/watch/${v.videoId}`}
                  />
                </li>
              ))}
            </ol>
            {remaining > 0 && (
              <Button
                variant="secondary"
                size="xl"
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-4 w-full"
              >
                {loadingMore ? '불러오는 중' : `더 보기 (${remaining}개 남음)`}
              </Button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
