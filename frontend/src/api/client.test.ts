import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'

/** 주소별 가짜 서버 응답. 처리한 요청은 calls 에 쌓인다 */
type Reply = { status: number; data: unknown }
let routes: Record<string, Reply[]> = {}
let calls: { url: string; auth: string | undefined }[] = []

const ok = (data: unknown): Reply => ({ status: 200, data: { statusCode: 200, data, error: null } })
const fail = (status: number, code: string): Reply => ({
  status,
  data: { statusCode: status, message: code, data: null, error: { code } },
})

const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const url = config.url ?? ''
  calls.push({ url, auth: config.headers?.Authorization as string | undefined })
  const reply = routes[url]?.shift() ?? fail(404, 'COMMON_005')
  const res = { data: reply.data, status: reply.status, statusText: '', headers: {}, config }
  if (reply.status >= 400) throw new AxiosError('fail', undefined, config, null, res)
  return res
}

// client.ts 가 axios.create 를 부르기 전에 가짜 adapter 를 기본값으로 둔다
axios.defaults.adapter = adapter
const { request, onSessionEvent } = await import('./client')
const { tokenStore } = await import('./token')

const session = vi.fn()
beforeEach(() => {
  routes = {}
  calls = []
  session.mockReset()
  onSessionEvent(session)
  tokenStore.set('old')
})

describe('401 처리', () => {
  test('COMMON_002 를 받으면 재발급 후 한 번 다시 보낸다 (로그아웃하지 않음)', async () => {
    routes['/users/me/settings'] = [fail(401, 'COMMON_002'), ok({ speechRate: 1.2 })]
    routes['/auth/reissue'] = [ok({ accessToken: 'new' })]
    await expect(
      request({ method: 'PATCH', url: '/users/me/settings', data: { speechRate: 1.2 } }),
    ).resolves.toEqual({ speechRate: 1.2 })
    expect(calls.map((c) => c.url)).toEqual([
      '/users/me/settings',
      '/auth/reissue',
      '/users/me/settings',
    ])
    expect(calls[2].auth).toBe('Bearer new')
    expect(session).not.toHaveBeenCalled()
  })

  test('재발급 뒤에도 같은 요청이 401 이면 그 요청만 실패하고 로그아웃하지 않는다', async () => {
    routes['/users/me/settings'] = [fail(401, 'COMMON_002'), fail(401, 'COMMON_002')]
    routes['/auth/reissue'] = [ok({ accessToken: 'new' })]
    await expect(request({ method: 'PATCH', url: '/users/me/settings' })).rejects.toMatchObject({
      code: 'COMMON_002',
    })
    expect(session).not.toHaveBeenCalled()
    expect(tokenStore.get()).toBe('new')
  })

  test('재발급도 실패하면 세션 만료로 알린다', async () => {
    routes['/users/me/settings'] = [fail(401, 'COMMON_002')]
    routes['/auth/reissue'] = [fail(401, 'AUTH_002')]
    await expect(request({ method: 'PATCH', url: '/users/me/settings' })).rejects.toMatchObject({
      code: 'AUTH_002',
    })
    expect(session).toHaveBeenCalledWith('expired')
    expect(tokenStore.get()).toBeNull()
  })

  test('AccessToken 만료(AUTH_003)는 전처럼 재발급 후 다시 보낸다', async () => {
    routes['/videos'] = [fail(401, 'AUTH_003'), ok({ content: [] })]
    routes['/auth/reissue'] = [ok({ accessToken: 'new' })]
    await expect(request({ url: '/videos' })).resolves.toEqual({ content: [] })
    expect(session).not.toHaveBeenCalled()
  })
})

describe('세션 끝 이유', () => {
  test('다른 탭에서 로그인 정보가 바뀌어 재발급이 거절되면(AUTH_004) 그 이유로 알린다', async () => {
    routes['/videos'] = [fail(401, 'AUTH_003')]
    routes['/auth/reissue'] = [fail(401, 'AUTH_004')]
    await expect(request({ url: '/videos' })).rejects.toMatchObject({ code: 'AUTH_004' })
    expect(session).toHaveBeenCalledWith('replaced')
  })

  test('관리자 화면이 아닌 403 은 홈으로 보내지 않고 화면이 처리한다', async () => {
    routes['/jobs/5'] = [fail(403, 'COMMON_003')]
    await expect(request({ url: '/jobs/5' })).rejects.toMatchObject({ code: 'COMMON_003' })
    expect(session).not.toHaveBeenCalled()
    routes['/admin/users'] = [fail(403, 'COMMON_003')]
    await expect(request({ url: '/admin/users' })).rejects.toMatchObject({ code: 'COMMON_003' })
    expect(session).toHaveBeenCalledWith('forbidden')
  })
})
