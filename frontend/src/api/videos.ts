import { request } from './client'
import type {
  Chapters,
  ChatHistory,
  Description,
  Paged,
  Playback,
  SceneAt,
  RetryResult,
  VideoCategory,
  VideoDetail,
  VideoSummary30,
  VideoSummary,
  Visibility,
  VisibilityResult,
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
  /** 업로드한 회원만 공개 범위를 변경할 수 있다 */
  updateVisibility: (videoId: number, visibility: Visibility) =>
    request<VisibilityResult>({
      method: 'PATCH',
      url: `/videos/${videoId}/visibility`,
      data: { visibility },
    }),
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
  /** 재생 주소. 업로드 영상은 1시간 유효, 유튜브는 영상 ID */
  playback: (videoId: number) => request<Playback>({ url: `/videos/${videoId}/playback` }),
  /** 재생용 해설 전체 (문장·장면·대사·화면 글자). 음성 주소는 6시간 유효 */
  description: (videoId: number) => request<Description>({ url: `/videos/${videoId}/description` }),
  /** 장면 목차 */
  chapters: (videoId: number) => request<Chapters>({ url: `/videos/${videoId}/chapters` }),
  /** 30초 요약 (문장·음성·권장 여부) */
  summary: (videoId: number) => request<VideoSummary30>({ url: `/videos/${videoId}/summary` }),
  /** 지금 시각 장면의 자세한 설명 (AI 호출 없음) */
  sceneAt: (videoId: number, ms: number) =>
    request<SceneAt>({ url: `/videos/${videoId}/scenes/at`, params: { ms } }),
  /** 이 영상에서 내가 한 질문·명령 기록 (최신순) */
  chatHistory: (videoId: number, cursor?: number, size = 50) =>
    request<ChatHistory>({ url: `/videos/${videoId}/chat/messages`, params: { cursor, size } }),
}
