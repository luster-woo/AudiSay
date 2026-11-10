import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import { tokenStore } from './token'
import { ApiError, NetworkError } from './errors'
import type { ApiResponse } from './types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
/** axios 를 거치지 않는 요청(keepalive fetch 등)이 쓸 API 주소 */
export const API_BASE_URL = BASE_URL

/**
 * 세션 만료 시 로직.
 * - expired: 로그인이 만료됐다
 * - replaced: 다른 탭·창에서 로그인 정보가 바뀌어 로그아웃됐다(AUTH_004, 동시 접속 불가)
 * - forbidden: 관리자 화면 권한이 없다
 */
type SessionListener = (reason: 'expired' | 'replaced' | 'forbidden') => void
let sessionListener: SessionListener | null = null
export function onSessionEvent(listener: SessionListener | null) {
  sessionListener = listener
}

/** 재발급까지 실패해 세션이 끝났을 때 (SSE 처럼 axios 를 거치지 않는 요청에서 쓴다) */
export function expireSession(err?: unknown) {
  tokenStore.clear()
  sessionListener?.(endReason(err))
}

/** 재발급 실패의 이유: 다른 탭·창이 먼저 바꿨으면(AUTH_004) replaced, 아니면 expired */
function endReason(err: unknown): 'expired' | 'replaced' {
  return err instanceof ApiError && err.code === 'AUTH_004' ? 'replaced' : 'expired'
}

/** 재발급 실패 → 세션을 끝내고, 원래 요청에는 그 이유의 오류를 돌려준다 */
function endSession(err: unknown): ApiError {
  const reason = endReason(err)
  tokenStore.clear()
  sessionListener?.(reason)
  return reason === 'replaced'
    ? (err as ApiError)
    : new ApiError('AUTH_002', 401, '로그인이 만료됐어요.')
}

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  timeout: 15_000,
  headers: { Accept: 'application/json' },
})

/**
 * 재발급 전용 인스턴스. 앱을 열 때 세션 복원도 이걸로 한다:
 * 시간 제한이 없으면 서버·프록시가 응답하지 않을 때 빈 화면이 끝없이 이어져 api 와 같은 15초를 둔다
 */
const bare = axios.create({ baseURL: BASE_URL, withCredentials: true, timeout: 15_000 })

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
      // 서버가 준 이유(AUTH_002 만료 / AUTH_004 다른 탭에서 바뀜)를 ApiError 로 돌려준다
      .catch((error: AxiosError<ApiResponse<null>>) => {
        if (!error.response) throw new NetworkError()
        const { status, data } = error.response
        throw new ApiError(data?.error?.code ?? 'AUTH_002', status, data?.message ?? '')
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
      } catch (err) {
        throw endSession(err)
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
      } catch (err) {
        throw endSession(err)
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
    // 관리자 화면의 역할 거부만 전역으로 처리한다(홈으로). 그 밖의 403(남의 작업·영상 등 소유 확인)은
    // 화면이 직접 안내한다 — 모든 403을 '권한 없음 → 홈 이동'으로 보내면 낭독기 사용자는 왜 홈에 왔는지 모른다
    if (status === 403 && code === 'COMMON_003' && (config?.url ?? '').startsWith('/admin')) {
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
