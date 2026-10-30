import { tokenStore } from './token'
import { reissueAccessToken } from './client'
import { ApiError, NetworkError } from './errors'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
const HEARTBEAT_TIMEOUT_MS = 45_000

export interface SseMessage {
  event: string
  data: string
}
export interface SseOptions {
  onMessage: (msg: SseMessage) => void
  /** 서버가 정상 종료했거나 heartbeat 가 끊겼을 때. reason 으로 복구 여부를 정한다 */
  onClose: (reason: 'done' | 'timeout' | 'error', error?: unknown) => void
  signal?: AbortSignal
}

function logDev(label: string, detail: unknown) {
  if (import.meta.env.DEV) console.warn(`[sse] ${label}`, detail)
}

export async function subscribeSse(path: string, opts: SseOptions, retried = false): Promise<void> {
  const controller = new AbortController()
  opts.signal?.addEventListener('abort', () => controller.abort())

  // ── 1. 연결 시도 ─────────────────────────────────────────────
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${tokenStore.get() ?? ''}`,
      },
      credentials: 'include',
      signal: controller.signal,
    })
  } catch (e) {
    // 호출부가 abort 한 경우는 정상 종료이므로 아무것도 알리지 않는다
    if (controller.signal.aborted) return
    // 그 외는 DNS 실패·서버 다운·오프라인 등 네트워크 단계의 실패
    logDev('연결 실패', e)
    opts.onClose('error', new NetworkError())
    return
  }

  // ── 2. HTTP 에러 응답 ──
  if (!res.ok) {
    let code = 'COMMON_004'
    let message = ''
    try {
      const body = (await res.json()) as { error?: { code?: string }; message?: string }
      code = body.error?.code ?? code
      message = body.message ?? ''
    } catch (e) {
      // 프록시·게이트웨이가 HTML 이나 빈 본문을 준 경우. 상태 코드만으로 처리한다
      logDev(`본문 파싱 실패 (HTTP ${res.status})`, e)
    }

    // AccessToken 만료 → 재발급 후 딱 한 번 다시 연결
    if (res.status === 401 && code === 'AUTH_003' && !retried) {
      try {
        await reissueAccessToken()
        return subscribeSse(path, opts, true)
      } catch (e) {
        // RefreshToken 도 만료. client.ts 의 reissue 가 tokenStore 를 비우고
        // 세션 리스너를 호출하므로 여기서는 호출부에 이유만 전달한다
        logDev('재발급 실패', e)
        opts.onClose('error', new ApiError('AUTH_002', 401, '로그인이 만료되었습니다.'))
        return
      }
    }

    opts.onClose('error', new ApiError(code, res.status, message))
    return
  }

  // ── 3. 스트림 읽기 ──
  if (!res.body) {
    opts.onClose('error', new NetworkError())
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined

  const resetHeartbeat = () => {
    clearTimeout(heartbeatTimer)
    heartbeatTimer = setTimeout(() => {
      controller.abort()
      opts.onClose('timeout')
    }, HEARTBEAT_TIMEOUT_MS)
  }
  resetHeartbeat()

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      resetHeartbeat()
      buffer += decoder.decode(value, { stream: true })

      // 이벤트는 빈 줄(\n\n)로 구분된다
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const msg = parseEvent(raw)
        if (msg) opts.onMessage(msg)
      }
    }
    opts.onClose('done')
  } catch (e) {
    // abort 로 끊긴 경우: heartbeat 타이머가 이미 'timeout' 을 알렸거나
    // 호출부가 직접 끊은 것이므로 다시 알리지 않는다
    if (controller.signal.aborted) return
    // 읽는 도중 서버가 연결을 끊은 경우 (배포·재시작 등)
    logDev('스트림 중단', e)
    opts.onClose('error', new NetworkError())
  } finally {
    clearTimeout(heartbeatTimer)
  }
}

/**
 * "event: progress\ndata: {...}" 블록 하나를 파싱한다.
 * ": heartbeat" 처럼 콜론으로 시작하는 줄은 SSE 주석이라 건너뛴다.
 */
function parseEvent(raw: string): SseMessage | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}