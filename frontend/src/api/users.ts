import { request } from './client'
import type { Me, UserSettings } from './types'

export const usersApi = {
  me: () => request<Me>({ url: '/users/me' }),
  settings: () => request<UserSettings>({ url: '/users/me/settings' }),
  updateSettings: (patch: Partial<UserSettings>) =>
    request<UserSettings>({ method: 'PATCH', url: '/users/me/settings', data: patch }),
}