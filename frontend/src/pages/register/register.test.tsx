import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { uploadsApi } from '@/api/uploads'
import { ApiError } from '@/api/errors'
import { DEFAULT_SETTINGS, type Quota } from '@/api/types'
import { readVideoDuration } from '@/features/upload/fileRules'
import { uploadParts, UploadNetworkError } from '@/features/upload/uploadParts'
import { renderRoute } from '@/test/renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/users', () => ({
  usersApi: {
    me: vi.fn(),
    settings: vi.fn(),
    updateSettings: vi.fn(),
    quota: vi.fn(),
    myVideos: vi.fn(),
  },
}))
vi.mock('@/api/uploads', () => ({
  uploadsApi: { start: vi.fn(), partUrls: vi.fn(), complete: vi.fn(), abort: vi.fn() },
}))
vi.mock('@/features/upload/fileRules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/upload/fileRules')>()
  return { ...actual, readVideoDuration: vi.fn() }
})
vi.mock('@/features/upload/uploadParts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/upload/uploadParts')>()
  return { ...actual, uploadParts: vi.fn() }
})

const MB = 1024 * 1024
const quota = (remaining = 3): Quota => ({
  role: 'VISUALLY_IMPAIRED',
  date: '2026-11-02',
  youtube: { maxDurationSec: 3600, limit: 5, used: 0, remaining: 5 },
  upload: { maxDurationSec: 3600, maxSizeBytes: 2 * MB, limit: 3, used: 3 - remaining, remaining },
})
const videoFile = (bytes = MB, name = '학습영상_3주차.mp4') =>
  new File([new Uint8Array(bytes)], name, { type: 'video/mp4' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reissueAccessToken).mockResolvedValue('t')
  vi.mocked(usersApi.me).mockResolvedValue({
    userId: 1,
    email: 'a@b.co',
    name: '김하늘',
    role: 'VISUALLY_IMPAIRED',
    verified: true,
    verifiedAt: null,
    createdAt: '2026-10-20T00:00:00Z',
  })
  vi.mocked(usersApi.settings).mockResolvedValue({ ...DEFAULT_SETTINGS, tutorialCompleted: true })
  vi.mocked(usersApi.quota).mockResolvedValue(quota())
  vi.mocked(readVideoDuration).mockResolvedValue(250)
  vi.mocked(uploadsApi.start).mockResolvedValue({ videoId: 15, partSizeBytes: MB, partCount: 1 })
  vi.mocked(uploadsApi.abort).mockResolvedValue(null)
})

/** 파일을 고르고 제목 → 공개 범위 단계까지 간다 */
async function goToVisibility(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByLabelText('파일 고르기')
  await user.upload(input, videoFile())
  await user.click(await screen.findByRole('button', { name: '다음' }))
  await screen.findByRole('heading', { name: '누구에게 보일까요?' })
}

async function startUpload(user: ReturnType<typeof userEvent.setup>) {
  await goToVisibility(user)
  await user.click(screen.getByLabelText(/이 영상을 올릴 권리가 저에게 있어요/))
  await user.click(screen.getByRole('button', { name: '올리고 해설 만들기' }))
}

test('1단계: 파일 고르기에 포커스, 남은 횟수와 조건을 알려 준다', async () => {
  const { container } = renderRoute('/register')
  const input = await screen.findByLabelText('파일 고르기')
  await waitFor(() => expect(input).toHaveFocus())
  expect(input).toHaveAccessibleDescription('MP4 · MOV · WebM 파일 · 60분 · 2MB 이하')
  expect(screen.getByText('오늘 3개 더 올릴 수 있어요.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '영상 등록' })).toHaveAttribute('aria-current', 'page')
  expect(await axe(container)).toHaveNoViolations()
})

test('용량을 넘는 파일은 업로드 불가 창, 처음 포커스는 다른 파일 고르기', async () => {
  const user = userEvent.setup()
  renderRoute('/register')
  await user.upload(await screen.findByLabelText('파일 고르기'), videoFile(3 * MB))
  const dialog = await screen.findByRole('alertdialog', { name: '파일 크기가 2MB를 넘었어요.' })
  expect(within(dialog).getByText('해상도를 낮춰 저장한 뒤 다시 골라 주세요.')).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: '다른 파일 고르기' })).toHaveFocus()
  await user.click(within(dialog).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})

test('제목은 파일 이름으로 채워지고, 권리 동의 없이 올리면 동의 칸으로 옮긴다', async () => {
  const user = userEvent.setup()
  renderRoute('/register')
  await user.upload(await screen.findByLabelText('파일 고르기'), videoFile())
  const title = await screen.findByRole('textbox', { name: '제목' })
  await waitFor(() => expect(title).toHaveFocus())
  expect(title).toHaveValue('학습영상_3주차')
  expect(screen.getByText(/학습영상_3주차\.mp4 · 4분 10초 · 1MB/)).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '다음' }))
  const privateRadio = await screen.findByRole('radio', { name: /비공개/ })
  await waitFor(() => expect(privateRadio).toHaveFocus())
  expect(privateRadio).toBeChecked()

  await user.click(screen.getByRole('button', { name: '올리고 해설 만들기' }))
  const agree = screen.getByLabelText(/이 영상을 올릴 권리가 저에게 있어요/)
  expect(agree).toHaveFocus()
  expect(agree).toHaveAttribute('aria-invalid', 'true')
  expect(uploadsApi.start).not.toHaveBeenCalled()
})

test('다 올리면 해설 만들기 화면으로 간다', async () => {
  vi.mocked(uploadParts).mockResolvedValue([{ partNumber: 1, eTag: '"a"' }])
  vi.mocked(uploadsApi.complete).mockResolvedValue({
    videoId: 15,
    jobId: 31,
    result: 'NEW_JOB',
    remaining: 2,
  })
  const user = userEvent.setup()
  const { router } = renderRoute('/register')
  await goToVisibility(user)
  await user.click(screen.getByRole('radio', { name: /공개/, checked: false }))
  await user.click(screen.getByLabelText(/이 영상을 올릴 권리가 저에게 있어요/))
  await user.click(screen.getByRole('button', { name: '올리고 해설 만들기' }))

  expect(uploadsApi.start).toHaveBeenCalledWith({
    title: '학습영상_3주차',
    originalFilename: '학습영상_3주차.mp4',
    contentType: 'video/mp4',
    sizeBytes: MB,
    durationSec: 250,
    visibility: 'PUBLIC',
    copyrightAgreed: true,
  })
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/31'))
  expect(uploadsApi.complete).toHaveBeenCalledWith(15, [{ partNumber: 1, eTag: '"a"' }])
})

test('업로드 멈추기 → 확인 → 멈추기: 올린 조각을 지우고 처음 단계로', async () => {
  vi.mocked(uploadParts).mockReturnValue(new Promise(() => {}))
  const user = userEvent.setup()
  renderRoute('/register')
  await startUpload(user)
  expect(await screen.findByRole('heading', { name: '영상을 올리고 있어요' })).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: '업로드 진행률' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '업로드 멈추기' }))
  const dialog = await screen.findByRole('dialog', { name: '업로드를 멈출까요?' })
  expect(within(dialog).getByRole('button', { name: '계속 올리기' })).toHaveFocus()
  await user.click(within(dialog).getByRole('button', { name: '멈추기' }))
  expect(uploadsApi.abort).toHaveBeenCalledWith(15)
  expect(
    await screen.findByRole('heading', { name: '올릴 영상 파일을 골라 주세요' }),
  ).toBeInTheDocument()
})

test('연결이 끊기면 처음부터 다시 올리기 / 업로드 취소를 고른다', async () => {
  vi.mocked(uploadParts).mockRejectedValue(new UploadNetworkError())
  const user = userEvent.setup()
  renderRoute('/register')
  await startUpload(user)
  const dialog = await screen.findByRole('alertdialog', { name: '연결이 끊겨 업로드가 멈췄어요' })
  expect(within(dialog).getByRole('button', { name: '처음부터 다시 올리기' })).toHaveFocus()
  expect(within(dialog).getByText('오늘 횟수는 쓰지 않았어요.')).toBeInTheDocument()

  await user.click(within(dialog).getByRole('button', { name: '업로드 취소' }))
  expect(uploadsApi.abort).toHaveBeenCalledWith(15)
  expect(
    await screen.findByRole('heading', { name: '올릴 영상 파일을 골라 주세요' }),
  ).toBeInTheDocument()
})

test('서버가 시작을 거절하면 이유를 3단계에 보여 준다', async () => {
  vi.mocked(uploadsApi.start).mockRejectedValue(new ApiError('UPLOAD_002', 400, ''))
  const user = userEvent.setup()
  renderRoute('/register')
  await startUpload(user)
  const notice = await screen.findByRole('region', { name: '올리기를 시작하지 못했어요' })
  expect(notice).toHaveTextContent('파일이 너무 커요. 해상도를 낮춰서 올려 주세요.')
})

test('오늘 횟수를 다 썼으면 파일을 고를 수 없다', async () => {
  vi.mocked(usersApi.quota).mockResolvedValue(quota(0))
  renderRoute('/register')
  expect(await screen.findByLabelText('파일 고르기')).toBeDisabled()
  expect(screen.getByRole('region', { name: '오늘 올리기 횟수를 다 썼어요' })).toBeInTheDocument()
})

test('올리는 중에 다른 메뉴를 누르면 먼저 묻고, 계속 올리기를 고르면 머문다', async () => {
  vi.mocked(uploadParts).mockReturnValue(new Promise(() => {}))
  const user = userEvent.setup()
  const { router } = renderRoute('/register')
  await startUpload(user)
  await screen.findByRole('heading', { name: '영상을 올리고 있어요' })

  await user.click(screen.getByRole('link', { name: '홈' }))
  const dialog = await screen.findByRole('dialog', { name: '업로드를 멈추고 나갈까요?' })
  await user.click(within(dialog).getByRole('button', { name: '계속 올리기' }))
  expect(router.state.location.pathname).toBe('/register')
  expect(uploadsApi.abort).not.toHaveBeenCalled()

  await user.click(screen.getByRole('link', { name: '홈' }))
  const again = await screen.findByRole('dialog', { name: '업로드를 멈추고 나갈까요?' })
  await user.click(within(again).getByRole('button', { name: '멈추고 나가기' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(uploadsApi.abort).toHaveBeenCalledWith(15)
})
