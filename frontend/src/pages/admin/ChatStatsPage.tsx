import { type ReactNode, useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { toUserMessage } from '@/api/errors'
import { queryKeys } from '@/api/queryKeys'
import type { ChatStats } from '@/api/types'
import { cn } from '@/components/ui/cn'
import {
  deriveChatStats,
  formatMs,
  formatShortDateTime,
  formatVideoTime,
  INTENT_P95_TARGET_MS,
  intentLabel,
} from '@/features/admin/chatStats'
import { DateRangePicker } from '@/features/admin/DateRangePicker'
import { Segmented } from '@/features/admin/Segmented'
import {
  formatDayLong,
  formatInt,
  formatRate,
  MAX_RANGE_DAYS,
  presetRange,
  RANGE_PRESETS,
  todayKst,
  type RangePreset,
} from '@/features/admin/stats'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'

/** 표 칸 (통계 화면과 같은 치수) */
const CELL = 'px-[0.8rem] py-[0.6rem] text-left'
const NUM = `${CELL} text-right whitespace-nowrap tabular-nums`
const TH = 'font-normal'
const CARD = 'rounded-sm border border-line bg-paper'

/** 막대 칸 색. 색만으로 구분하지 않도록 밝기를 크게 다르게 둔다 */
const SEG = {
  dark: 'bg-navy',
  mid: 'bg-[#5b7bab]',
  light: 'bg-[#b7c6dc]',
  warn: 'bg-yellow',
} as const
type SegColor = keyof typeof SEG

type Derived = ReturnType<typeof deriveChatStats>

/** 챗봇 품질 통계: 챗봇이 얼마나 쓰였고, 질문에 얼마나 잘 답했는지 본다 */
export default function ChatStatsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { announce } = useAnnouncer()

  const [preset, setPreset] = useState<RangePreset | null>('30d')
  const [range, setRange] = useState(() => presetRange('30d'))

  const { data, error, isError, isFetching } = useQuery({
    queryKey: queryKeys.admin.chatStats(range.from, range.to),
    queryFn: () => adminApi.chatStats(range.from, range.to),
    placeholderData: keepPreviousData,
  })

  usePageEntry({
    title: '챗봇 품질 통계',
    announce: '챗봇 품질 통계 화면이에요. 기간을 골라 챗봇 사용과 답변 결과를 볼 수 있어요.',
    focusRef: headingRef,
    ready: data !== undefined || isError,
  })

  // 기간을 바꾸면 결과가 도착한 뒤 요약을 읽어 준다
  const pendingAnnounce = useRef(false)
  useEffect(() => {
    if (!pendingAnnounce.current || isFetching) return
    if (data) {
      pendingAnnounce.current = false
      const d = deriveChatStats(data)
      announce(
        `${formatDayLong(data.from)}부터 ${formatDayLong(data.to)}까지, 입력 ${formatInt(data.inputs)}건, 바로 답한 질문 ${formatRate(d.directRate)}.`,
      )
    } else if (isError) {
      pendingAnnounce.current = false
      announce(`통계를 불러오지 못했어요. ${toUserMessage(error)}`, { politeness: 'assertive' })
    }
  }, [data, isError, error, isFetching, announce])

  const applyRange = (next: { from: string; to: string }) => {
    setRange(next)
    pendingAnnounce.current = true
  }
  const choosePreset = (p: RangePreset) => {
    setPreset(p)
    applyRange(presetRange(p))
  }
  const pickRange = (next: { from: string; to: string }) => {
    setPreset(
      RANGE_PRESETS.find((p) => {
        const r = presetRange(p.value)
        return r.from === next.from && r.to === next.to
      })?.value ?? null,
    )
    applyRange(next)
  }

  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-[1.4667rem] leading-snug font-bold outline-none"
      >
        챗봇 품질 통계
      </h1>

      <div className="mt-[1.2rem] flex flex-wrap items-end gap-[0.8667rem]">
        <Segmented legend="기간" options={RANGE_PRESETS} value={preset} onChange={choosePreset} />
        <DateRangePicker
          value={range}
          max={todayKst()}
          maxDays={MAX_RANGE_DAYS}
          onApply={pickRange}
        />
      </div>

      {isError && !data ? (
        <p className={`mt-[1.4667rem] ${CARD} px-[0.8rem] py-6`}>
          통계를 불러오지 못했어요. {toUserMessage(error)}
        </p>
      ) : !data ? (
        <p className={`mt-[1.4667rem] ${CARD} px-[0.8rem] py-6`}>통계를 불러오는 중이에요.</p>
      ) : (
        <ChatStatsBody data={data} className={cn(isFetching && 'opacity-60')} />
      )}
    </div>
  )
}

function ChatStatsBody({ data, className }: { data: ChatStats; className?: string }) {
  const d = deriveChatStats(data)
  return (
    <div className={cn('transition-opacity', className)}>
      <SummaryTiles data={data} d={d} />
      <div className="mt-[1.4667rem] grid gap-[1.4667rem] xl:grid-cols-[3fr_2fr]">
        <AnswerResult data={data} d={d} />
        <SeekResult data={data} />
      </div>
      <div className="mt-[1.4667rem] grid gap-[1.4667rem] xl:grid-cols-2">
        <IntentTable data={data} />
        <AnswerTable data={data} />
      </div>
      <UnansweredList data={data} d={d} />
    </div>
  )
}

/** 분모가 0이면 비율 대신 "–" */
const rateOrDash = (part: number, whole: number) => (whole === 0 ? '–' : formatRate(part / whole))

const EMPTY = <p className="text-[0.9333rem] text-ink-muted">기록 없음</p>

/* ── 요약 ── */

function SummaryTiles({ data, d }: { data: ChatStats; d: Derived }) {
  const slowWarn = d.slowest != null && d.slowest.ms > INTENT_P95_TARGET_MS
  const tiles: { label: string; value: string; note?: string; warn?: boolean }[] = [
    { label: '챗봇 입력', value: `${formatInt(data.inputs)}건` },
    {
      label: '바로 답한 질문',
      value: rateOrDash(d.direct, data.answer.questions),
      note: `${formatInt(d.direct)} / ${formatInt(data.answer.questions)}건`,
    },
    {
      label: '첫 응답 음성 p95',
      value: formatMs(d.question?.firstAudioP95Ms ?? null),
      note: d.question ? `p50 ${formatMs(d.question.firstAudioP50Ms)}` : undefined,
    },
    {
      label: '분류 시간 p95 (최대)',
      value: formatMs(d.slowest?.ms ?? null),
      note: d.slowest
        ? `${slowWarn ? '목표 1.5초 초과 · ' : ''}${intentLabel(d.slowest.intent)}`
        : undefined,
      warn: slowWarn,
    },
    {
      label: '못 알아들은 입력',
      value: rateOrDash(d.unknown, data.inputs),
      note: `${formatInt(d.unknown)}건`,
    },
    {
      label: '장면 찾기 성공',
      value: rateOrDash(d.seekFound, data.seek.total),
      note: data.seek.total
        ? `${formatInt(d.seekFound)} / ${formatInt(data.seek.total)}건`
        : undefined,
    },
  ]
  return (
    <section aria-label="기간 요약" className="mt-[1.4667rem]">
      <dl className="grid grid-cols-3 gap-[0.8667rem] xl:grid-cols-6">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={cn(`${CARD} px-[1rem] py-[0.8667rem]`, t.warn && 'border-danger')}
          >
            <dt className="text-[0.8667rem] text-ink-muted">{t.label}</dt>
            <dd className="mt-[0.2667rem] text-[1.4667rem] leading-tight font-bold tabular-nums">
              {t.value}
            </dd>
            {t.note && (
              <dd
                className={cn(
                  'mt-[0.2667rem] text-[0.8rem] text-ink-muted',
                  t.warn && 'font-bold text-danger',
                )}
              >
                {t.note}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  )
}

/* ── 카드 머리 (제목 + 오른쪽 건수) ── */

function CardHead({ id, title, meta }: { id: string; title: string; meta?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-[1.0667rem] font-bold">
        {title}
      </h2>
      {meta && <span className="text-[0.8667rem] text-ink-muted tabular-nums">{meta}</span>}
    </div>
  )
}

/* ── 비율 막대 + 범례 ── */

interface Part {
  label: string
  /** null 이면 아직 집계하지 않는 값 (BE가 주지 않음) */
  count: number | null
  color: SegColor
}

function SplitBar({ parts, total, columns }: { parts: Part[]; total: number; columns: 1 | 2 }) {
  return (
    <>
      {/* 그림은 낭독기에서 숨기고, 아래 목록으로 같은 값을 읽는다 */}
      <div
        aria-hidden="true"
        className="mt-[1rem] flex h-[2rem] overflow-hidden rounded-sm bg-cream"
      >
        {parts.map(
          (p, i) =>
            p.count != null &&
            p.count > 0 && (
              <div
                key={p.label}
                className={cn(SEG[p.color], i > 0 && 'border-l-2 border-paper')}
                style={{ flex: `${p.count} 1 0` }}
              />
            ),
        )}
      </div>
      <ul
        className={cn(
          'mt-[0.9333rem] grid gap-x-[1.3333rem] gap-y-[0.6667rem] text-[0.9333rem]',
          columns === 2 && 'sm:grid-cols-2',
        )}
      >
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-[0.5333rem]">
            <span
              aria-hidden="true"
              className={cn('size-3 shrink-0 rounded-[2px]', SEG[p.color])}
            />
            <span className="flex-1">{p.label}</span>
            {p.count == null ? (
              <span className="text-ink-muted">준비 중</span>
            ) : (
              <>
                <b className="tabular-nums">{formatInt(p.count)}건</b>
                <span className="w-[3.4rem] text-right text-ink-muted tabular-nums">
                  {rateOrDash(p.count, total)}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

/* ── 질문 답변 결과 ── */

function AnswerResult({ data, d }: { data: ChatStats; d: Derived }) {
  const a = data.answer
  return (
    <section aria-labelledby="answer-result-title" className={`${CARD} p-[1.2rem]`}>
      <CardHead
        id="answer-result-title"
        title="질문 답변 결과"
        meta={`질문 ${formatInt(a.questions)}건`}
      />
      <SplitBar
        columns={2}
        total={a.questions}
        parts={[
          { label: '바로 답함', count: d.direct, color: 'dark' },
          { label: '뒤에 답 있음 · 들음', count: a.futureChosen, color: 'mid' },
          { label: '뒤에 답 있음 · 안 들음', count: d.offeredDeclined, color: 'light' },
          { label: '답 없음', count: d.nowhere, color: 'warn' },
        ]}
      />
    </section>
  )
}

/* ── 장면 찾기 ── */

function SeekResult({ data }: { data: ChatStats }) {
  const s = data.seek
  return (
    <section aria-labelledby="seek-title" className={`${CARD} p-[1.2rem]`}>
      <CardHead id="seek-title" title="장면 찾기" meta={`요청 ${formatInt(s.total)}건`} />
      <SplitBar
        columns={1}
        total={s.total}
        parts={[
          { label: '키워드', count: s.keyword, color: 'dark' },
          // BE가 아직 rag 를 주지 않으면 '준비 중' (0건으로 보이면 RAG가 못 찾은 것처럼 읽힘)
          { label: 'RAG', count: s.rag ?? null, color: 'mid' },
          { label: 'AI 선택', count: s.llm, color: 'light' },
          { label: '못 찾음', count: s.notFound, color: 'warn' },
        ]}
      />
    </section>
  )
}

/* ── 표 ── */

function TableCard({
  id,
  title,
  empty,
  children,
}: {
  id: string
  title: string
  empty: boolean
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className={`overflow-hidden ${CARD}`}>
      <h2 id={id} className="px-[1.2rem] pt-[1.2rem] pb-[0.8rem] text-[1.0667rem] font-bold">
        {title}
      </h2>
      {empty ? (
        <div className="px-[1.2rem] pb-[1.2rem]">{EMPTY}</div>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  )
}

function HeadRow({ cols }: { cols: string[] }) {
  return (
    <thead className="bg-cream text-[0.8667rem] text-ink-muted">
      <tr>
        {cols.map((c, i) => (
          <th key={c} scope="col" className={`${i === 0 ? CELL : NUM} ${TH}`}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function IntentTable({ data }: { data: ChatStats }) {
  return (
    <TableCard id="intent-title" title="입력 종류별" empty={data.byIntent.length === 0}>
      <table className="w-full text-[0.9333rem]">
        <HeadRow cols={['종류', '입력', '비중', '분류 p50', '분류 p95']} />
        <tbody>
          {data.byIntent.map((i) => (
            <tr key={i.intent} className="border-t border-line">
              <th scope="row" className={`${CELL} font-bold whitespace-nowrap`}>
                {intentLabel(i.intent)}
              </th>
              <td className={NUM}>{formatInt(i.count)}</td>
              <td className={NUM}>{formatRate(data.inputs ? i.count / data.inputs : 0)}</td>
              <td className={NUM}>{formatMs(i.intentP50Ms)}</td>
              <td
                className={cn(
                  NUM,
                  i.intentP95Ms != null &&
                    i.intentP95Ms > INTENT_P95_TARGET_MS &&
                    'font-bold text-danger',
                )}
              >
                {formatMs(i.intentP95Ms)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  )
}

function AnswerTable({ data }: { data: ChatStats }) {
  return (
    <TableCard id="answer-title" title="답변 종류별" empty={data.answer.byIntent.length === 0}>
      <table className="w-full text-[0.9333rem]">
        <HeadRow
          cols={['종류', '답변', '바로 답함', '답 없음', '골라 들음', '첫 음성 p50', '첫 음성 p95']}
        />
        <tbody>
          {data.answer.byIntent.map((i) => (
            <tr key={i.intent} className="border-t border-line">
              <th scope="row" className={`${CELL} font-bold whitespace-nowrap`}>
                {intentLabel(i.intent)}
              </th>
              <td className={NUM}>{formatInt(i.answered)}</td>
              <td className={NUM}>{formatInt(i.stored)}</td>
              <td className={NUM}>{formatInt(i.unanswerable)}</td>
              <td className={NUM}>{formatInt(i.future)}</td>
              <td className={NUM}>{formatMs(i.firstAudioP50Ms)}</td>
              <td className={NUM}>{formatMs(i.firstAudioP95Ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  )
}

/* ── 답이 없던 질문 ── */

function UnansweredList({ data, d }: { data: ChatStats; d: Derived }) {
  const rows = data.recentUnanswered
  return (
    <section
      aria-labelledby="unanswered-title"
      className={`mt-[1.4667rem] overflow-hidden ${CARD}`}
    >
      <div className="px-[1.2rem] pt-[1.2rem] pb-[0.8rem]">
        <CardHead
          id="unanswered-title"
          title="답이 없던 질문"
          meta={
            d.nowhere > rows.length
              ? `최근 ${rows.length}건 / 전체 ${formatInt(d.nowhere)}건`
              : undefined
          }
        />
      </div>
      {rows.length === 0 ? (
        <div className="px-[1.2rem] pb-[1.2rem]">{EMPTY}</div>
      ) : (
        <div className="max-h-[22rem] overflow-auto">
          <table className="w-full text-[0.9333rem]">
            <thead className="sticky top-0 bg-cream text-[0.8667rem] text-ink-muted">
              <tr>
                <th scope="col" className={`${CELL} ${TH}`}>
                  시각
                </th>
                <th scope="col" className={`${CELL} ${TH}`}>
                  질문
                </th>
                <th scope="col" className={`${CELL} ${TH}`}>
                  영상
                </th>
                <th scope="col" className={`${NUM} ${TH}`}>
                  시점
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.chatLogId} className="border-t border-line">
                  <td className={`${CELL} font-mono text-[0.8667rem] whitespace-nowrap`}>
                    {formatShortDateTime(r.createdAt)}
                  </td>
                  <td className={`${CELL} font-bold`}>{r.utterance}</td>
                  <td className={`${CELL} text-ink-muted`}>
                    {r.videoId == null ? '–' : (r.videoTitle ?? `영상 ${r.videoId}`)}
                  </td>
                  <td className={NUM}>{formatVideoTime(r.videoTimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
