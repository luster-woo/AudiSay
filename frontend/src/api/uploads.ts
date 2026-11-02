import { request } from './client'
import type {
  UploadCompleteResult,
  UploadPartUrls,
  UploadStartBody,
  UploadStartResult,
} from './types'

/** 영상 파일 올리기 (S3 멀티파트): 시작 → 조각 주소 발급 → 조각 PUT → 완료 */
export const uploadsApi = {
  /** 형식·길이·용량·횟수 사전 검사 후 업로드 시작. 횟수는 완료 때 줄어든다 */
  start: (body: UploadStartBody) =>
    request<UploadStartResult>({ method: 'POST', url: '/uploads', data: body }),
  /** 조각 번호들의 S3 PUT 주소 (한 번에 최대 20개, 30분 유효) */
  partUrls: (videoId: number, partNumbers: number[]) =>
    request<UploadPartUrls>({
      method: 'POST',
      url: `/uploads/${videoId}/parts`,
      data: { partNumbers },
    }),
  /** 모든 조각을 올린 뒤 호출 → 해설 만들기 작업 시작, 횟수 차감 */
  complete: (videoId: number, parts: { partNumber: number; eTag: string }[]) =>
    request<UploadCompleteResult>({
      method: 'POST',
      url: `/uploads/${videoId}/complete`,
      data: { parts },
    }),
  /** 업로드 중단. 올라간 조각을 지우고 횟수는 쓰지 않는다 */
  abort: (videoId: number) => request<null>({ method: 'DELETE', url: `/uploads/${videoId}` }),
}
