import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { reissueAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { adminApi, type AdminReportListParams } from '@/api/admin'
import { ApiError } from '@/api/errors'
import type { AdminReport, Paged, ReviewDescription } from '@/api/types'
import { renderRoute } from '@/test/renderWithProviders'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, reissueAccessToken: vi.fn() }
})
vi.mock('@/api/users', () => ({
  usersApi: { me: vi.fn(), settings: vi.fn(), updateSettings: vi.fn() },
}))
vi.mock('@/api/admin', () => ({
  adminApi: {
    reports: vi.fn(),
    handleReport: vi.fn(),
    reviewDescription: vi.fn(),
    updateLine: vi.fn(),
    regenerateLineAudio: vi.fn(),
    regenerate: vi.fn(),
  },
}))

const report = (patch: Partial<AdminReport>): AdminReport => ({
  reportId: 7,
  status: 'PENDING',
  reason: 'WRONG',
  reasonDetail: '막대가 세 개가 아니라 네 개예요.',
  videoId: 12,
  videoTitle: '그래프를 읽는 방법',
  descriptionId: 20,
  lineId: 501,
  detailLevel: 2,
  lineStartMs: 134000,
  reportedAtMs: 136000,
  lineTextSnapshot: '세 개의 막대가 있는 그래프예요',
  currentText: '세 개의 막대가 있는 그래프예요',
  sameLineReportCount: 2,
  reporterId: 4,
  createdAt: '2026-10-22T00:12:00Z',
  handledAt: null,
  ...patch,
})

const REPORTS = [
  report({}),
  report({
    reportId: 9,
    reason: 'MISSING',
    reasonDetail: 'D반 막대를 안 읽어 줘요.',
    createdAt: '2026-10-23T05:40:00Z',
  }),
  report({
    reportId: 11,
    videoId: 13,
    videoTitle: '김치볶음밥, 10분이면 충분해요',
    descriptionId: 30,
    lineId: 601,
    reason: 'MISSING',
    lineStartMs: 70000,
    currentText: '냄비에 물을 붓습니다',
    lineTextSnapshot: '냄비에 물을 붓습니다',
    sameLineReportCount: 1,
    createdAt: '2026-10-22T12:40:00Z',
  }),
]

const paged = (content: AdminReport[], total = content.length): Paged<AdminReport> => ({
  content,
  page: { number: 0, size: 50, totalElements: total, totalPages: 1, first: true, last: true },
})

const review: ReviewDescription = {
  descriptionId: 20,
  videoId: 12,
  status: 'PUBLISHED',
  versions: [{ descriptionId: 20, status: 'PUBLISHED', createdAt: '2026-10-21T08:35:00Z' }],
  scenes: [
    {
      sceneId: 302,
      sceneIndex: 2,
      title: '막대그래프 비교',
      startMs: 129000,
      endMs: 139000,
      sceneDescription: '막대 4개(A·B·C·D). B가 가장 높음.',
      keyframeUrl: null,
    },
  ],
  lines: [
    {
      lineId: 501,
      lineIndex: 1,
      detailLevel: 2,
      startMs: 134000,
      gapEndMs: 137200,
      importance: 2,
      text: '세 개의 막대가 있는 그래프예요',
      audioUrl: null,
      audioDurationMs: 4100,
      reportCount: 2,
      pendingReportCount: 2,
      updatedAt: '2026-10-21T08:35:00Z',
    },
  ],
  dialogues: [{ startMs: 128000, endMs: 130000, text: '자, 반별로 보면요', characterName: null }],
  screenTexts: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reissueAccessToken).mockResolvedValue('t')
  vi.mocked(usersApi.me).mockResolvedValue({
    userId: 1,
    email: 'admin@audisay.kr',
    name: '정해린',
    role: 'ADMIN',
    verified: false,
    verifiedAt: null,
    createdAt: '2026-10-20T00:00:00Z',
  })
  vi.mocked(usersApi.settings).mockReturnValue(new Promise(() => {}))
  vi.mocked(adminApi.reports).mockImplementation(async (p: AdminReportListParams) =>
    p.size === 1 ? paged([], 3) : paged(p.status === 'PENDING' ? REPORTS : []),
  )
  vi.mocked(adminApi.reviewDescription).mockResolvedValue(review)
})

describe('신고 처리', () => {
  test('같은 문장의 신고를 한 줄로 묶고, 첫 문장을 열어 장면과 고칠 문장을 보여 준다', async () => {
    const { container } = renderRoute('/admin/reports')
    expect(await screen.findByRole('heading', { level: 1, name: '신고 처리' })).toBeInTheDocument()
    const listHeading = await screen.findByRole('heading', { level: 2, name: '처리 전 3건' })
    await waitFor(() => expect(listHeading).toHaveFocus())
    // 처리 상태는 위쪽 줄 가운데 (라디오 묶음)
    const statuses = within(screen.getByRole('group', { name: '처리 상태' }))
    expect(statuses.getByRole('radio', { name: /^처리 전\s*3\s*건$/ })).toBeChecked()
    expect(statuses.getAllByRole('radio')).toHaveLength(3)

    const list = within(screen.getByRole('region', { name: '처리 전 3건' }))
    const links = list.getAllByRole('link')
    expect(links).toHaveLength(2) // 신고 3건 → 문장 2개
    expect(links[0]).toHaveAccessibleName(/그래프를 읽는 방법.*신고 2건/)

    expect(screen.getByRole('link', { name: /신고 처리/ })).toHaveTextContent('3')
    expect(await screen.findByText('막대 4개(A·B·C·D). B가 가장 높음.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '해설 문장 · 2단계' })).toHaveValue(
      '세 개의 막대가 있는 그래프예요',
    )
    expect(screen.getByText(/0\.9초 넘침/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2건 처리 완료' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  test('문장을 고쳐 저장한 뒤, 고른 신고를 한 번에 처리 완료한다', async () => {
    vi.mocked(adminApi.updateLine).mockResolvedValue({
      lineId: 501,
      descriptionId: 20,
      detailLevel: 2,
      startMs: 134000,
      importance: 2,
      text: '네 개의 막대가 있는 그래프예요',
      audioUrl: null,
      updatedAt: '2026-10-24T00:00:00Z',
    })
    vi.mocked(adminApi.handleReport).mockResolvedValue({
      reportId: 7,
      status: 'RESOLVED',
      handledAt: '2026-10-24T00:00:00Z',
      updatedReportIds: [7, 9],
    })
    const user = userEvent.setup()
    renderRoute('/admin/reports/7')

    const text = await screen.findByRole('textbox', { name: '해설 문장 · 2단계' })
    await user.clear(text)
    await user.type(text, '네 개의 막대가 있는 그래프예요')
    await user.click(screen.getByRole('button', { name: '문장 저장' }))
    expect(adminApi.updateLine).toHaveBeenCalledWith(501, {
      text: '네 개의 막대가 있는 그래프예요',
      importance: undefined,
    })

    await user.click(screen.getByRole('button', { name: '2건 처리 완료' }))
    expect(adminApi.handleReport).toHaveBeenCalledWith(7, 'RESOLVED', true)
    expect((await screen.findAllByText('신고 2건을 처리 완료했어요.')).length).toBeGreaterThan(0)
  })

  test('신고 탭에서 한 건만 반려할 수 있고, 이미 처리된 신고면 알려 준다', async () => {
    vi.mocked(adminApi.handleReport).mockRejectedValue(
      new ApiError('REPORT_003', 409, '이미 처리된 신고입니다.'),
    )
    const user = userEvent.setup()
    renderRoute('/admin/reports/7')

    await user.click(await screen.findByRole('tab', { name: '신고 2' }))
    expect(screen.getByText('“D반 막대를 안 읽어 줘요.”')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /^이 건만 반려/ })[1])
    expect(adminApi.handleReport).toHaveBeenCalledWith(9, 'REJECTED')
    expect((await screen.findAllByText('이미 처리된 신고예요.')).length).toBeGreaterThan(0)
  })

  test('전체 해설 다시 만들기는 확인을 받고, 처음 포커스는 취소에 있다', async () => {
    vi.mocked(adminApi.regenerate).mockResolvedValue({
      videoId: 12,
      jobId: 45,
      jobType: 'REGENERATE',
      currentDescriptionId: 20,
    })
    const user = userEvent.setup()
    renderRoute('/admin/reports/7')

    await user.click(await screen.findByRole('button', { name: '전체 해설 다시 만들기' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: '이 영상의 해설을 전부 다시 만들까요?',
    })
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: '다시 만들기' }))
    expect(adminApi.regenerate).toHaveBeenCalledWith(12)
  })
})
