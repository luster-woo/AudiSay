import { request } from './client'
import { tokenStore } from './token'
import type { LoginResult } from './types'

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
  signup(body: { email: string; password: string; name: string }) {
    return request<null>({ method: 'POST', url: '/auth/signup', data: body })
  },
  checkEmail(email: string) {
    return request<{ available: boolean }>({ url: '/auth/email/availability', params: { email } })
  },
}