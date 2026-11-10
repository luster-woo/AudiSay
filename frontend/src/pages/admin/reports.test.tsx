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
// 장면 탭의 영상 플레이어 (업로드 영상)
vi.mock('@/api/videos', () => ({
  videosApi: {
    playback: vi.fn(async () => ({
      sourceType: 'UPLOAD',
      playbackUrl: 'https://media.example/v12.mp4',
      playbackFormat: 'MP4',
      expiresAt: null,
      youtubeVideoId: null,
    })),
  },
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
  test('목록은 같은 문장 신고를 한 줄로 묶은 표이고, 줄을 열면 그 문장 상세만 보인다', async () => {
    const user = userEvent.setup()
    const { container } = renderRoute('/admin/reports')
    expect(await screen.findByRole('heading', { level: 1, name: '신고 처리' })).toBeInTheDocument()
    // 문장 2줄 (신고는 3개)
    const listHeading = await screen.findByRole('heading', { level: 2, name: /^처리 전 2건/ })
    await waitFor(() => expect(listHeading).toHaveFocus())
    // 처리 상태는 위쪽 줄 가운데 (라디오 묶음)
    const statuses = within(screen.getByRole('group', { name: '처리 상태' }))
    expect(statuses.getByRole('radio', { name: /^처리 전\s*3\s*건$/ })).toBeChecked()
    expect(statuses.getAllByRole('radio')).toHaveLength(3)

    const table = screen.getByRole('table', { name: /신고 목록/ })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['영상', '신고된 문장', '사유', '신고 수', '첫 신고'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2) // 신고 3건 → 문장 2개
    expect(rows[0]).toHaveTextContent('2건')
    // 서버는 한 상태의 신고를 모두 받아 묶는다 (쪽마다 묶으면 같은 문장이 갈라진다)
    expect(adminApi.reports).toHaveBeenCalledWith({ status: 'PENDING', page: 0, size: 50 })
    expect(await axe(container)).toHaveNoViolations()

    // 줄을 열면 목록 없이 상세만
    await user.click(within(rows[0]).getByRole('link', { name: '그래프를 읽는 방법' }))
    const detailHeading = await screen.findByRole('heading', {
      level: 2,
      name: '그래프를 읽는 방법',
    })
    await waitFor(() => expect(detailHeading).toHaveFocus())
    expect(screen.queryByRole('table', { name: /신고 목록/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /처리 전 신고 목록/ })).toHaveAttribute(
      'href',
      '/admin/reports',
    )
    expect(screen.getByRole('link', { name: /신고 처리/ })).toHaveTextContent('3')
    expect(await screen.findByText('막대 4개(A·B·C·D). B가 가장 높음.')).toBeInTheDocument()
    // 장면 영상은 실제 플레이어(시청 화면과 같은 재생 주소)로 보여 주고, 화면 글자 목록은 없다
    const sceneRegion = screen.getByRole('region', { name: '장면' })
    await waitFor(() =>
      expect(sceneRegion.querySelector('video')).toHaveAttribute(
        'src',
        'https://media.example/v12.mp4',
      ),
    )
    expect(within(sceneRegion).queryByText(/화면 글자/)).not.toBeInTheDocument()
    expect(within(sceneRegion).getByRole('button', { name: '재생' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '해설 문장 · 2단계' })).toHaveValue(
      '세 개의 막대가 있는 그래프예요',
    )
    expect(screen.getByText(/0\.9초 넘침/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2건 처리 완료' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  test('처리 상태를 바꾸면 포커스는 상태 라디오에 그대로 두고 결과만 알린다 (진입 안내를 다시 읽지 않는다)', async () => {
    renderRoute('/admin/reports')
    const heading = await screen.findByRole('heading', { name: /^처리 전/ })
    await waitFor(() => expect(heading).toHaveFocus())
    const done = screen.getByRole('radio', { name: /^처리 완료/ })
    await userEvent.click(done)
    await waitFor(() => expect(screen.getByText(/^처리 완료 \d+건\.$/)).toBeInTheDocument())
    expect(done).toHaveFocus()
    expect(screen.queryAllByText(/신고 처리 화면이에요/).length).toBeLessThanOrEqual(1)
  })

  test('빈 구간이 없는 문장(gapEndMs null)은 넘침으로 보지 않고 멈추고 읽는다고 알린다', async () => {
    vi.mocked(adminApi.reviewDescription).mockResolvedValue({
      ...review,
      lines: [{ ...review.lines[0], startMs: 30000, gapEndMs: null, audioDurationMs: 5800 }],
    })
    renderRoute('/admin/reports/7')
    expect(
      await screen.findByText(
        '대사 사이 빈 구간이 없어요 · 재생할 때 영상을 멈추고 이 문장을 읽어요',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/넘침/)).not.toBeInTheDocument()
    expect(screen.queryByText(/-\d/)).not.toBeInTheDocument()
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
      audioRegenerating: true,
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

  test('신고 탭에서 한 건만 골라 반려할 수 있고, 이미 처리된 신고면 알려 준다', async () => {
    vi.mocked(adminApi.handleReport).mockRejectedValue(
      new ApiError('REPORT_003', 409, '이미 처리된 신고예요.'),
    )
    const user = userEvent.setup()
    renderRoute('/admin/reports/7')

    await user.click(await screen.findByRole('tab', { name: '신고 2' }))
    expect(screen.getByText('“D반 막대를 안 읽어 줘요.”')).toBeInTheDocument()
    // 처음엔 전부 골라져 있다. 첫 신고를 빼고 남은 한 건만 반려
    await user.click(screen.getAllByRole('checkbox')[1])
    await user.click(screen.getByRole('button', { name: '1건 반려' }))
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
