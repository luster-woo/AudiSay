import { request } from './client'
import type { Me, MyVideo, Paged, Quota, UserSettings, VerificationResult } from './types'

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
  /** 시각장애인 인증. 서류는 서버에 저장되지 않는다 (형식·용량만 검사) */
  verify: (document: File) => {
    const form = new FormData()
    form.append('document', document)
    form.append('sensitiveAgreed', 'true')
    return request<VerificationResult>({
      method: 'POST',
      url: '/users/me/verification',
      data: form,
    })
  },
}
