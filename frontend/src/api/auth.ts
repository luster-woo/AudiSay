import { request } from './client'
import { tokenStore } from './token'
import type { EmailAvailability, LoginResult, SignupResult } from './types'

export const authApi = {
  async login(email: string, password: string) {
    const result = await request<LoginResult>({ method: 'POST', url: '/auth/login', data: { email, password } })
    tokenStore.set(result.accessToken)
    return result
  },
  async logout() {
    try {
      await request<null>({ method: 'POST', url: '/auth/logout' })
    } finally {
      tokenStore.clear()
    }
  },
  /** 가입만 한다 (로그인은 하지 않음). termsAgreed 는 true 만 허용 */
  signup(body: { email: string; password: string; name: string; termsAgreed: true }) {
    return request<SignupResult>({ method: 'POST', url: '/auth/signup', data: body })
  },
  checkEmail(email: string) {
    return request<EmailAvailability>({ url: '/auth/email/availability', params: { email } })
  },
}
