import { useMutation, useQueryClient } from '@tanstack/react-query'
import { favoritesApi } from '@/api/favorites'
import { toUserMessage } from '@/api/errors'
import type { Paged, VideoSummary } from '@/api/types'
import { useAnnouncer } from '@/features/announcer/context'

/**
 * 즐겨찾기 넣기/빼기. 버튼 이름이 바로 바뀌도록 영상 목록 캐시를 먼저 고친다(낙관적 갱신).
 * 실패하면 되돌리고 이유를 읽어 준다.
 */
export function useFavoriteToggle() {
  const queryClient = useQueryClient()
  const { announce } = useAnnouncer()

  const setFavorite = (videoId: number, isFavorite: boolean) =>
    queryClient.setQueriesData<Paged<VideoSummary>>({ queryKey: ['videos'] }, (old) =>
      old && 'content' in old
        ? {
            ...old,
            content: old.content.map((v) => (v.videoId === videoId ? { ...v, isFavorite } : v)),
          }
        : old,
    )

  const mutation = useMutation({
    mutationFn: ({ video }: { video: VideoSummary }) =>
      video.isFavorite ? favoritesApi.remove(video.videoId) : favoritesApi.add(video.videoId),
    onMutate: ({ video }) => setFavorite(video.videoId, !video.isFavorite),
    onSuccess: (res, { video }) => {
      void queryClient.invalidateQueries({ queryKey: ['favorites'] })
      announce(
        res.isFavorite
          ? `${video.title}, 즐겨찾기에 넣었어요.`
          : `${video.title}, 즐겨찾기에서 뺐어요.`,
      )
    },
    onError: (err, { video }) => {
      setFavorite(video.videoId, video.isFavorite)
      announce(`즐겨찾기를 바꾸지 못했어요. ${toUserMessage(err)}`, { politeness: 'assertive' })
    },
  })

  return (video: VideoSummary) => mutation.mutate({ video })
}
