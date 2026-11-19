import { waitFor } from '@testing-library/react'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { DEFAULT_SETTINGS, type Me, type Role, type UserSettings } from '@/api/types'
import { renderWithProviders } from '@/test/renderWithProviders'
import { DISPLAY_KEY } from './displayCache'
import indexHtml from '../../../index.html?raw'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/users', () => ({
  usersApi: { me: vi.fn(), settings: vi.fn(), updateSettings: vi.fn() },
}))

const reissue = vi.mocked(reissueAccessToken)
const me = vi.mocked(usersApi.me)
const settings = vi.mocked(usersApi.settings)
const html = document.documentElement

function loginAs(role: Role) {
  reissue.mockResolvedValue('token')
  me.mockResolvedValue({
    userId: 1,
    email: 'a@b.c',
    name: '김하늘',
    role,
    verified: role === 'VISUALLY_IMPAIRED',
    verifiedAt: null,
    createdAt: '2026-10-20T00:00:00Z',
  } satisfies Me)
}
const stored = () => JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? 'null') as unknown

/** index.html 의 인라인 스크립트(그리기 전에 칠하는 부분)를 그대로 실행한다 */
function runIndexScript(pathname: string) {
  const script = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1]
  window.history.replaceState(null, '', pathname)
  new Function(script)()
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  html.dataset.fontScale = '3'
  html.dataset.contrast = 'normal'
})

test('기억해 둔 글자 크기·고대비는 설정 응답을 기다리는 동안 기본값으로 덮이지 않는다', async () => {
  localStorage.setItem(DISPLAY_KEY, JSON.stringify({ fontSizeLevel: 5, highContrast: true }))
  html.dataset.fontScale = '5' // index.html 이 그리기 전에 칠해 둔 상태
  html.dataset.contrast = 'high'
  loginAs('VISUALLY_IMPAIRED')
  settings.mockReturnValue(new Promise(() => {})) // 응답이 오지 않는 동안
  renderWithProviders(<p>화면</p>)
  await waitFor(() => expect(settings).toHaveBeenCalled())
  expect(html.dataset.fontScale).toBe('5')
  expect(html.dataset.contrast).toBe('high')
})

test('설정을 받으면 html 에 칠하고 이 브라우저에 기억한다', async () => {
  loginAs('VISUALLY_IMPAIRED')
  settings.mockResolvedValue({
    ...DEFAULT_SETTINGS,
    fontSizeLevel: 4,
    highContrast: true,
  } satisfies UserSettings)
  renderWithProviders(<p>화면</p>)
  await waitFor(() => expect(html.dataset.fontScale).toBe('4'))
  expect(html.dataset.contrast).toBe('high')
  expect(stored()).toEqual({ fontSizeLevel: 4, highContrast: true })
})

test('관리자는 고정 크기로 칠하고, 사용자 화면용 기억에는 남기지 않는다', async () => {
  loginAs('ADMIN')
  settings.mockResolvedValue({ ...DEFAULT_SETTINGS, fontSizeLevel: 5, highContrast: true })
  renderWithProviders(<p>화면</p>)
  await waitFor(() => expect(html.dataset.fontScale).toBe('2'))
  expect(html.dataset.contrast).toBe('normal')
  expect(stored()).toBeNull()
})

test('index.html 은 기억해 둔 값을 그리기 전에 칠한다 (관리자 주소·깨진 값은 건너뛴다)', () => {
  localStorage.setItem(DISPLAY_KEY, JSON.stringify({ fontSizeLevel: 5, highContrast: true }))
  runIndexScript('/')
  expect(html.dataset.fontScale).toBe('5')
  expect(html.dataset.contrast).toBe('high')

  html.dataset.fontScale = '3'
  html.dataset.contrast = 'normal'
  runIndexScript('/admin/users')
  expect(html.dataset.fontScale).toBe('3')

  localStorage.setItem(DISPLAY_KEY, '{깨진 값')
  runIndexScript('/')
  expect(html.dataset.fontScale).toBe('3')
  expect(html.dataset.contrast).toBe('normal')
})
