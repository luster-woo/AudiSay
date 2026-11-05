import { request } from './client'
import type { Me, MyVideo, Paged, Quota, UserSettings, VerificationResult } from './types'

/** 인증 신청 요청의 시간 제한 (서버 OCR 확인 시간 + 여유) */
export const VERIFY_TIMEOUT_MS = 60_000

export const usersApi = {
  me: () => request<Me>({ url: '/users/me' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<null>({
      method: 'PATCH',
      url: '/users/me/password',
      data: { currentPassword, newPassword },
    }),
  withdraw: (password: string) =>
    request<null>({ method: 'DELETE', url: '/users/me', data: { password } }),
  settings: () => request<UserSettings>({ url: '/users/me/settings' }),
  updateSettings: (patch: Partial<UserSettings>) =>
    request<UserSettings>({ method: 'PATCH', url: '/users/me/settings', data: patch }),
  /** 오늘 남은 이용 횟수 */
  quota: () => request<Quota>({ url: '/users/me/quota' }),
  /** 내가 요청하거나 올린 영상 (최신순) */
  myVideos: (page = 0, size = 20) =>
    request<Paged<MyVideo>>({ url: '/users/me/videos', params: { page, size } }),
  /**
   * 시각장애인 인증. 서버가 서류 글자를 읽어(OCR) 종류만 확인하고 저장하지 않는다.
   * 확인에 시간이 걸려 이 요청만 시간 제한을 늘린다: 15초에 끊으면 화면은 실패인데 서버는 승인해,
   * 다시 누르면 USER_003(이미 인증)이 된다
   */
  verify: (document: File) => {
    const form = new FormData()
    form.append('document', document)
    form.append('sensitiveAgreed', 'true')
    return request<VerificationResult>({
      method: 'POST',
      url: '/users/me/verification',
      data: form,
      timeout: VERIFY_TIMEOUT_MS,
    })
  },
}
