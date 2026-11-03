import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { favoritesApi } from '@/api/favorites'
import { usersApi } from '@/api/users'
import { videosApi } from '@/api/videos'
import { queryKeys } from '@/api/queryKeys'
import { toUserMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { Pagination } from '@/components/ui/Pagination'
import { Tabs } from '@/components/ui/Tabs'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { QuotaAside } from '@/features/video/QuotaAside'
import { VideoCard } from '@/features/video/VideoCard'
import { FavoriteVideoCard } from './FavoriteVideoCard'
import { MyVideoCard } from './MyVideoCard'

const PAGE_SIZE = 4
type VideoTab = 'requested' | 'favorites'

/** 내 영상·즐겨찾기. 목록은 각각의 서버 페이지를 사용하고 현재 탭·페이지를 URL에 남긴다. */
export default function MyVideosPage() {
  const [params, setParams] = useSearchParams()
  const tab: VideoTab = params.get('tab') === 'favorites' ? 'favorites' : 'requested'
  const requestedPage = Number(params.get('page') ?? 0)
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 0 ? requestedPage : 0
  const headingRef = useRef<HTMLHeadingElement>(null)
  const listRef = useRef<HTMLHeadingElement>(null)
  const pendingFocus = useRef<'page' | 'tab' | null>(null)
  const previousStatuses = useRef(new Map<number, string>())
  const { announce } = useAnnouncer()

  const mine = useQuery({
    queryKey: queryKeys.myVideos(tab === 'requested' ? page : 0, PAGE_SIZE),
    queryFn: () => usersApi.myVideos(tab === 'requested' ? page : 0, PAGE_SIZE),
    placeholderData: keepPreviousData,
    refetchInterval: (q) =>
      q.state.data?.content.some((v) => v.descriptionStatus === 'GENERATING') ? 5000 : false,
  })
  const favorites = useQuery({
    queryKey: queryKeys.favorites(tab === 'favorites' ? page : 0, PAGE_SIZE),
    queryFn: () => favoritesApi.list(tab === 'favorites' ? page : 0, PAGE_SIZE),
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

  useEffect(() => {
    if (
      !pendingFocus.current ||
      active.isFetching ||
      active.isPlaceholderData ||
      total === undefined
    )
      return
    if (pendingFocus.current === 'page') listRef.current?.focus({ preventScroll: true })
    pendingFocus.current = null
    const start = total === 0 ? 0 : page * PAGE_SIZE + 1
    const end = Math.min((page + 1) * PAGE_SIZE, total)
    announce(
      `${label} ${total}개. ${total === 0 ? '아직 영상이 없어요.' : `${start}번째부터 ${end}번째까지 보여 드려요.`}`,
    )
  }, [active.isFetching, active.isPlaceholderData, total, page, label, announce])

  useEffect(() => {
    if (active.isError)
      announce(`${label}을 불러오지 못했어요. ${toUserMessage(active.error)}`, {
        politeness: 'assertive',
      })
  }, [active.isError, active.error, label, announce])

  // 즐겨찾기 마지막 페이지의 마지막 항목이 삭제되거나 오래된 URL로 들어온 경우.
  useEffect(() => {
    if (
      !data ||
      active.isPlaceholderData ||
      active.isFetching ||
      page === 0 ||
      page < data.page.totalPages
    )
      return
    pendingFocus.current = 'page'
    const next = new URLSearchParams(params)
    next.set('page', String(Math.max(0, data.page.totalPages - 1)))
    setParams(next, { replace: true })
  }, [data, active.isPlaceholderData, active.isFetching, page, params, setParams])

  const changeTab = (next: VideoTab) => {
    if (next === tab) return
    pendingFocus.current = 'tab'
    setParams(next === 'favorites' ? { tab: next } : {})
  }
  const changePage = (next: number) => {
    if (active.isFetching) return
    pendingFocus.current = 'page'
    setParams({ ...(tab === 'favorites' ? { tab } : {}), page: String(next) })
  }

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
          <div className="mt-6 rounded-lg border-2 border-line bg-paper p-6">
            <p className="text-2xl font-bold">영상 목록을 불러오지 못했어요</p>
            <p className="mt-2 text-xl">{toUserMessage(active.error)}</p>
            <Button
              className="mt-5"
              variant="secondary"
              loading={active.isFetching}
              onClick={() => void active.refetch()}
            >
              다시 불러오기
            </Button>
          </div>
        )}
        {!active.isError && data && data.content.length > 0 && (
          <>
            <ul
              className="mt-6 grid items-stretch gap-6 md:grid-cols-2 xl:grid-cols-4"
              aria-label={label}
            >
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
            </ul>
            <div className="mt-4 [&_nav]:flex-wrap [&_nav>div]:ml-auto [&_nav>div]:max-w-full [&_nav>div]:flex-wrap [&_nav>div>button]:min-w-[10rem] sm:[&_nav>div>button]:min-w-[14rem] [&_nav>div]:gap-4">
              <Pagination page={data.page} onChange={changePage} size="xl" />
            </div>
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
