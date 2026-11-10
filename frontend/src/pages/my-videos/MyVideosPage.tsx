import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { favoritesApi } from '@/api/favorites'
import { usersApi } from '@/api/users'
import { videosApi } from '@/api/videos'
import { queryKeys } from '@/api/queryKeys'
import { toUserMessage } from '@/api/errors'
import { ListError } from '@/features/video/ListError'
import type { Paged } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { Tabs } from '@/components/ui/Tabs'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { QuotaAside } from '@/features/video/QuotaAside'
import { VideoCard } from '@/features/video/VideoCard'
import { FavoriteVideoCard } from './FavoriteVideoCard'
import { MyVideoCard } from './MyVideoCard'

/** 한 번에 더 보여 줄 개수 (홈과 같다) */
const STEP = 10
/** 서버가 한 번에 주는 최대 개수 (PageParams size 최대 50) */
const MAX_SIZE = 50
type VideoTab = 'requested' | 'favorites'

/** 앞에서부터 shown 개를 받는다. 50개를 넘으면 50개씩 나눠 받아 잇고, videoId 로 중복을 거른다 */
async function fetchShown<T extends { videoId: number }>(
  shown: number,
  load: (page: number, size: number) => Promise<Paged<T>>,
): Promise<Paged<T>> {
  const chunks = Math.max(1, Math.ceil(shown / MAX_SIZE))
  const size = chunks === 1 ? shown : MAX_SIZE
  const pages = await Promise.all(Array.from({ length: chunks }, (_, page) => load(page, size)))
  const seen = new Set<number>()
  const content = pages
    .flatMap((p) => p.content)
    .filter((v) => !seen.has(v.videoId) && seen.add(v.videoId))
    .slice(0, shown)
  return { content, page: pages[pages.length - 1].page }
}

/**
 * 내 영상·즐겨찾기. 홈과 같이 한 열 목록으로 10개씩 보여 주고 '더 보기'로 이어 붙인다.
 * 지금 탭과 불러온 개수는 주소(?tab=&shown=)에 남겨, 영상을 보고 뒤로 오면 그대로 돌아온다.
 */
export default function MyVideosPage() {
  const [params, setParams] = useSearchParams()
  const tab: VideoTab = params.get('tab') === 'favorites' ? 'favorites' : 'requested'
  const requestedShown = Number(params.get('shown') ?? STEP)
  const shown =
    Number.isSafeInteger(requestedShown) && requestedShown >= STEP ? requestedShown : STEP
  const headingRef = useRef<HTMLHeadingElement>(null)
  const listRef = useRef<HTMLHeadingElement>(null)
  const itemsRef = useRef<HTMLOListElement>(null)
  const pendingFocus = useRef<'tab' | null>(null)
  /** 더 보기로 새로 붙을 첫 영상 순번 */
  const focusFrom = useRef<number | null>(null)
  const previousStatuses = useRef(new Map<number, string>())
  const { announce } = useAnnouncer()

  const mine = useQuery({
    queryKey: queryKeys.myVideos(0, tab === 'requested' ? shown : STEP),
    queryFn: () => fetchShown(tab === 'requested' ? shown : STEP, usersApi.myVideos),
    placeholderData: keepPreviousData,
    refetchInterval: (q) =>
      q.state.data?.content.some((v) => v.descriptionStatus === 'GENERATING') ? 5000 : false,
  })
  const favorites = useQuery({
    queryKey: queryKeys.favorites(0, tab === 'favorites' ? shown : STEP),
    queryFn: () => fetchShown(tab === 'favorites' ? shown : STEP, favoritesApi.list),
    placeholderData: keepPreviousData,
  })
  const active = tab === 'requested' ? mine : favorites
  const data = active.data
  const label = tab === 'requested' ? '요청·올린 영상' : '즐겨찾기 영상'
  const total = data?.page.totalElements

  useEffect(() => {
    if (mine.isPlaceholderData || !mine.data) return
    for (const video of mine.data.content) {
      const previous = previousStatuses.current.get(video.videoId)
      previousStatuses.current.set(video.videoId, video.descriptionStatus)
      if (previous !== 'GENERATING') continue
      if (video.descriptionStatus === 'READY') announce(`${video.title}, 해설이 준비됐어요.`)
      if (video.descriptionStatus === 'FAILED')
        announce(`${video.title}, 해설을 만들지 못했어요. 다시 요청할 수 있어요.`, {
          politeness: 'assertive',
        })
    }
  }, [mine.data, mine.isPlaceholderData, announce])

  usePageEntry({
    title: '내 영상',
    announce: '내 영상이에요. 요청·올린 영상과 즐겨찾기를 확인할 수 있어요.',
    focusRef: headingRef,
  })

  // 탭을 바꾼 뒤: 개수는 탭 이름('즐겨찾기 3, 탭')에 이미 있어 다시 읽지 않는다 (원칙 2장). 비어 있을 때만 알린다
  useEffect(() => {
    if (!pendingFocus.current || active.isPlaceholderData || total === undefined) return
    pendingFocus.current = null
    if (total === 0) announce('아직 영상이 없어요.')
  }, [active.isPlaceholderData, total, announce])

  // 더 보기 뒤: 새로 붙은 첫 영상 제목으로 포커스를 옮기고 몇 개 불러왔는지 알린다
  useEffect(() => {
    const from = focusFrom.current
    if (from === null || active.isPlaceholderData || !data) return
    focusFrom.current = null
    const added = data.content.length - from
    if (added <= 0) {
      announce('더 불러올 영상이 없어요.')
      return
    }
    itemsRef.current?.querySelectorAll<HTMLElement>(':scope > li h3')[from]?.focus()
    const done = data.content.length >= data.page.totalElements
    announce(
      `${added}개 더 불러왔어요. 전체 ${data.page.totalElements}개 중 ${data.content.length}개.${done ? ' 모든 영상을 불러왔어요.' : ''}`,
    )
  }, [data, active.isPlaceholderData, announce])

  const changeTab = (next: VideoTab) => {
    if (next === tab) return
    pendingFocus.current = 'tab'
    setParams(next === 'favorites' ? { tab: next } : {})
  }
  const loadMore = () => {
    if (!data || active.isPlaceholderData) return
    focusFrom.current = data.content.length
    const next = new URLSearchParams(params)
    next.set('shown', String(shown + STEP))
    // 쌓지 않고 바꾼다: 뒤로 가기는 이전 화면으로, 다시 오면 이 상태로
    setParams(next, { replace: true, preventScrollReset: true })
  }
  const remaining = data ? Math.max(0, data.page.totalElements - data.content.length) : 0

  const recommendations = useQuery({
    queryKey: queryKeys.videos({ page: 0, size: 3 }),
    queryFn: () => videosApi.list({ page: 0, size: 3 }),
    enabled: tab === 'requested' && mine.isSuccess && mine.data.page.totalElements === 0,
  })

  const panel = (
    <>
      <div className="mb-8 lg:absolute lg:top-0 lg:right-0 lg:mb-0 lg:w-[19.375rem]">
        <QuotaAside showLeftNote={false} className="pt-4 [&_dl>div]:py-1 [&>p]:mt-5" />
      </div>
      <section aria-labelledby="my-video-list-title" className="mt-2" aria-busy={active.isFetching}>
        <div className="border-t border-line pt-6 lg:w-[67.1%]">
          <h2
            id="my-video-list-title"
            ref={listRef}
            tabIndex={-1}
            className="text-[1.75rem] font-bold"
          >
            {label}
          </h2>
        </div>
        {active.isPending && <p className="py-12 text-xl">영상을 불러오는 중이에요.</p>}
        {active.isError && (
          <ListError
            title="영상 목록을 불러오지 못했어요"
            error={active.error}
            announceText={`${label}을 불러오지 못했어요. ${toUserMessage(active.error)}`}
            retrying={active.isFetching}
            onRetry={() => void active.refetch()}
          />
        )}
        {!active.isError && data && data.content.length > 0 && (
          <>
            <ol ref={itemsRef} className="mt-6 space-y-3" aria-label={label}>
              {tab === 'requested'
                ? mine.data?.content.map((video) => (
                    <li key={video.videoId} className="min-w-0">
                      <MyVideoCard video={video} />
                    </li>
                  ))
                : favorites.data?.content.map((video) => (
                    <li key={video.videoId} className="min-w-0">
                      <FavoriteVideoCard
                        video={video}
                        onRemoved={() => listRef.current?.focus({ preventScroll: true })}
                      />
                    </li>
                  ))}
            </ol>
            {remaining > 0 && (
              <Button
                variant="secondary"
                size="xl"
                onClick={loadMore}
                disabled={active.isPlaceholderData}
                className="mt-4 w-full"
              >
                {active.isPlaceholderData ? '불러오는 중' : `더 보기 (${remaining}개 남음)`}
              </Button>
            )}
          </>
        )}
        {!active.isError && data && data.page.totalElements === 0 && (
          <div className="mt-6">
            <h3 className="text-[1.75rem] font-bold">
              {tab === 'requested' ? '아직 영상이 없어요' : '아직 즐겨찾기한 영상이 없어요'}
            </h3>
            <p className="mt-2 text-xl">
              {tab === 'requested'
                ? '해설을 요청하거나 직접 올린 영상이 여기에 모여요.'
                : '영상의 즐겨찾기 버튼을 누르면 여기에 모여요.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-4">
              <ButtonLink to="/" variant="primary" size="xl">
                해설 있는 영상 보기
              </ButtonLink>
              {tab === 'requested' && (
                <ButtonLink to="/register" size="xl">
                  영상 등록하기
                </ButtonLink>
              )}
            </div>
            {tab === 'requested' && !!recommendations.data?.content.length && (
              <section className="mt-8" aria-labelledby="recommended-videos-title">
                <h3 id="recommended-videos-title" className="text-[1.75rem] font-bold">
                  먼저 볼 수 있는 영상
                </h3>
                <ul className="mt-4 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {recommendations.data.content.map((video) => (
                    <li key={video.videoId} className="min-w-0">
                      <VideoCard
                        {...video}
                        centerDetails
                        actions={
                          <ButtonLink
                            to={`/watch/${video.videoId}`}
                            variant="primary"
                            size="xl"
                            className="w-full"
                            aria-label={`재생, ${video.title}`}
                          >
                            재생
                          </ButtonLink>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </section>
    </>
  )

  return (
    <div className="relative">
      <div className="lg:pr-[25rem]">
        <h1 ref={headingRef} tabIndex={-1} className="text-4xl font-bold">
          내 영상
        </h1>
        <p className="mt-2 text-xl">
          {tab === 'favorites'
            ? '다시 보고 싶은 영상을 모아뒀어요.'
            : '해설을 요청했거나 직접 올린 영상이에요. 최근 요청한 순서예요.'}
        </p>
      </div>
      <Tabs
        label="내 영상 분류"
        variant="pills"
        tabListClassName="lg:pr-[25rem]"
        className="mt-6"
        value={tab}
        onChange={changeTab}
        items={[
          {
            value: 'requested',
            label: `요청·올린 영상${mine.data ? ` ${mine.data.page.totalElements}` : ''}`,
            panel,
          },
          {
            value: 'favorites',
            label: `즐겨찾기${favorites.data ? ` ${favorites.data.page.totalElements}` : ''}`,
            panel,
          },
        ]}
      />
    </div>
  )
}
