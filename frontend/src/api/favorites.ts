import { request } from './client'
import type { FavoriteResult } from './types'

/** 즐겨찾기. 두 번 눌러도 오류가 나지 않는다 (서버가 멱등) */
export const favoritesApi = {
  add: (videoId: number) =>
    request<FavoriteResult>({ method: 'POST', url: `/favorites/${videoId}` }),
  remove: (videoId: number) =>
    request<FavoriteResult>({ method: 'DELETE', url: `/favorites/${videoId}` }),
}
