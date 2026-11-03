import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import { tokenStore } from './token'
import { ApiError, NetworkError } from './errors'
import type { ApiResponse } from './types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

/** 세션 만료 시 로직 */
type SessionListener = (reason: 'expired' | 'forbidden') => void
let sessionListener: SessionListener | null = null
export function onSessionEvent(listener: SessionListener | null) {
  sessionListener = listener
}

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  timeout: 15_000,
  headers: { Accept: 'application/json' },
})

/** 재발급 전용 인스턴스 */
const bare = axios.create({ baseURL: BASE_URL, withCredentials: true })

/** reissue 중복 방지 */
let reissuePromise: Promise<string> | null = null
export async function reissueAccessToken(): Promise<string> {
  if (!reissuePromise) {
    reissuePromise = bare
      .post<ApiResponse<{ accessToken: string }>>('/auth/reissue')
      .then((res) => {
        const token = res.data.data.accessToken
        tokenStore.set(token)
        return token
      })
      .finally(() => {
        reissuePromise = null
      })
  }
  return reissuePromise
}

// 요청: Bearer 첨부 
api.interceptors.request.use((config) => {
  const token = tokenStore.get()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 응답
type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean }

api.interceptors.response.use(
  (res) => res.data.data,
  async (error: AxiosError<ApiResponse<null>>) => {
    // 서버 응답 자체가 없음 (네트워크·타임아웃)
    if (!error.response) throw new NetworkError()

    const { status, data } = error.response
    const code = data?.error?.code ?? 'COMMON_004'
    const message = data?.message ?? ''
    const config = error.config as RetryConfig | undefined

    // AccessToken 만료 → 재발급 1회 후 원래 요청 재시도
    if (status === 401 && code === 'AUTH_003' && config && !config._retried) {
      config._retried = true
      try {
        const token = await reissueAccessToken()
        config.headers.Authorization = `Bearer ${token}`
        return api(config)
      } catch {
        tokenStore.clear()
        sessionListener?.('expired')
        throw new ApiError('AUTH_002', 401, '로그인이 만료되었습니다.')
      }
    }

    // 토큰이 잘못됨(COMMON_002): 토큰을 실어 보낸 요청이면 재발급을 한 번 시도한다.
    // 서버가 다른 오류(검증 실패 등)를 401 로 돌려주는 경우에 바로 로그아웃되지 않게 하기 위함.
    // 재발급이 실패하면 진짜 세션 만료다
    if (
      status === 401 &&
      code === 'COMMON_002' &&
      config &&
      !config._retried &&
      config.headers.Authorization
    ) {
      config._retried = true
      let token: string
      try {
        token = await reissueAccessToken()
      } catch {
        tokenStore.clear()
        sessionListener?.('expired')
        throw new ApiError('AUTH_002', 401, '로그인이 만료되었습니다.')
      }
      config.headers.Authorization = `Bearer ${token}`
      return api(config)
    }

    // 토큰 없음·Refresh 만료 → 세션 종료.
    // 방금 재발급에 성공하고 다시 보낸 요청이 또 401 이면 세션 문제가 아니라 그 요청의 문제라 로그아웃하지 않는다
    if (status === 401 && (code === 'COMMON_002' || code === 'AUTH_002') && !config?._retried) {
      tokenStore.clear()
      sessionListener?.('expired')
    }
    if (status === 403 && code === 'COMMON_003') {
      sessionListener?.('forbidden')
    }

    throw new ApiError(code, status, message)
  },
)

/**
 * 응답 인터셉터 type을 맞추는 함수
 * 사용: const me = await request<Me>({ url: '/users/me' })
 */
export function request<T>(config: AxiosRequestConfig): Promise<T> {
  return api.request(config) as unknown as Promise<T>
}