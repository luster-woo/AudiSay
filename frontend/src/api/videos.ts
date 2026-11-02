import { request } from './client'
import type {
  Paged,
  RetryResult,
  VideoCategory,
  VideoDetail,
  VideoSummary,
  YoutubeCheck,
  YoutubeRequestResult,
  YoutubeSearchResult,
} from './types'

export interface VideoListParams {
  category?: VideoCategory
  q?: string
  page?: number
  size?: number
}

export const videosApi = {
  /** 해설이 준비된 공개 영상 (최신순) */
  list: (params: VideoListParams) => request<Paged<VideoSummary>>({ url: '/videos', params }),
  /** 영상 정보와 해설 상태 (플레이어·해설 만들기 화면) */
  get: (videoId: number) => request<VideoDetail>({ url: `/videos/${videoId}` }),
  /** 유튜브 검색. 해설 있는 영상이 먼저 온다. 한 번에 10개 */
  youtubeSearch: (q: string, pageToken?: string) =>
    request<YoutubeSearchResult>({ url: '/videos/youtube/search', params: { q, pageToken } }),
  /** 유튜브 주소 사전 확인 (횟수 차감 없음) */
  youtubeCheck: (url: string) =>
    request<YoutubeCheck>({ method: 'POST', url: '/videos/youtube/check', data: { url } }),
  /** 유튜브 해설 요청. 새로 만들 때만 횟수 차감 */
  youtubeRequest: (url: string) =>
    request<YoutubeRequestResult>({ method: 'POST', url: '/videos/youtube', data: { url } }),
  /** 해설 생성에 실패한 영상 다시 요청 (횟수 차감 없음) */
  retry: (videoId: number) =>
    request<RetryResult>({ method: 'POST', url: `/videos/${videoId}/retry` }),
}
