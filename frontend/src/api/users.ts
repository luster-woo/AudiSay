import { request } from './client'
import type { Me, UserSettings, VerificationResult } from './types'

export const usersApi = {
  me: () => request<Me>({ url: '/users/me' }),
  settings: () => request<UserSettings>({ url: '/users/me/settings' }),
  updateSettings: (patch: Partial<UserSettings>) =>
    request<UserSettings>({ method: 'PATCH', url: '/users/me/settings', data: patch }),
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
