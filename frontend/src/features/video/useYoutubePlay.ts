import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { videosApi } from '@/api/videos'
import { queryKeys } from '@/api/queryKeys'
import { ApiError, toUserMessage } from '@/api/errors'
import type { Quota, YoutubeCheck, YoutubeSearchItem } from '@/api/types'
import { useAnnouncer } from '@/features/announcer/context'
import { youtubeShortUrl } from '@/utils/youtube'
import { rejectText } from './youtubeReject'

/** 같은 영상의 사전 확인은 잠시 재사용한다 (포커스·재생에서 여러 번 부르지 않게) */
const CHECK_STALE_MS = 5 * 60_000

/**
 * 검색 결과의 '재생'·'만들 수 없음' 동작.
 * - 해설 있음 → /watch/:videoId (요약 묻기부터)
 * - 해설 없음 → 사전 확인(횟수 안 씀) 후 해설 요청 → /jobs/:jobId
 *   (실패했던 영상은 다시 요청, 만드는 중이면 그 작업에 합류)
 */
export function useYoutubePlay(maxSec: number | null) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { announce } = useAnnouncer()
  /** 요청 중인 영상 (버튼을 '준비하는 중'으로) */
  const [pendingId, setPendingId] = useState<string | null>(null)
  const maxMin = maxSec == null ? null : Math.floor(maxSec / 60)

  const check = (item: YoutubeSearchItem) => {
    const url = youtubeShortUrl(item.youtubeVideoId)
    return queryClient.fetchQuery<YoutubeCheck>({
      queryKey: queryKeys.youtubeCheck(url),
      queryFn: () => videosApi.youtubeCheck(url),
      staleTime: CHECK_STALE_MS,
      retry: false,
    })
  }

  const play = async (item: YoutubeSearchItem) => {
    if (pendingId) return
    if (item.hasDescription && item.videoId != null) {
      navigate(`/watch/${item.videoId}`)
      return
    }
    setPendingId(item.youtubeVideoId)
    announce(`${item.title}, 재생을 준비하고 있어요.`)
    try {
      const c = await check(item)
      if (!c.available) {
        const r = rejectText(c.rejectReason, maxMin)
        announce(`${r.short} ${r.detail}`, { politeness: 'assertive' })
        return
      }
      if (c.descriptionStatus === 'READY' && c.videoId != null) {
        navigate(`/watch/${c.videoId}`)
        return
      }
      const quota = queryClient.getQueryData<Quota>(queryKeys.quota)
      if (c.willCount && quota?.youtube.remaining === 0) {
        announce('오늘 해설 만들기 횟수를 다 썼어요.', { politeness: 'assertive' })
        return
      }
      const res =
        c.descriptionStatus === 'FAILED' && c.videoId != null
          ? await videosApi.retry(c.videoId)
          : await videosApi.youtubeRequest(youtubeShortUrl(item.youtubeVideoId))
      void queryClient.invalidateQueries({ queryKey: queryKeys.quota })
      void queryClient.invalidateQueries({ queryKey: ['me', 'videos'] })
      if (res.jobId != null) navigate(`/jobs/${res.jobId}`)
      else navigate(`/watch/${res.videoId}`)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LIMIT_001') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.quota })
        announce('오늘 해설 만들기 횟수를 다 썼어요.', { politeness: 'assertive' })
      } else {
        announce(`재생하지 못했어요. ${toUserMessage(err)}`, { politeness: 'assertive' })
      }
    } finally {
      setPendingId(null)
    }
  }

  /** '만들 수 없음'에 포커스가 오면 서버가 알려 준 거절 이유를 읽어 준다 (횟수 안 씀) */
  const explainReject = async (item: YoutubeSearchItem) => {
    const fallback = rejectText('TOO_LONG', maxMin)
    try {
      const c = await check(item)
      const r = c.available ? fallback : rejectText(c.rejectReason, maxMin)
      announce(`${r.short} ${r.detail}`)
    } catch {
      announce(`${fallback.short} ${fallback.detail}`)
    }
  }

  return { play, explainReject, pendingId }
}
