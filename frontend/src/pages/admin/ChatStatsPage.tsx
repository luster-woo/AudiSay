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
      <p className="mt-[0.1333rem] text-[0.9333rem] text-ink-muted">
        챗봇이 얼마나 쓰였고, 질문에 얼마나 잘 답했는지 봐요.
      </p>

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

/* ── 요약 ── */

function SummaryTiles({ data, d }: { data: ChatStats; d: Derived }) {
  const top = data.byIntent
    .slice(0, 3)
    .map((i) => `${intentLabel(i.intent)} ${formatInt(i.count)}`)
    .join(' · ')
  const slowWarn = d.slowest != null && d.slowest.ms > INTENT_P95_TARGET_MS
  const tiles: { label: string; value: string; unit?: string; note: string; warn?: boolean }[] = [
    { label: '챗봇 입력', value: formatInt(data.inputs), unit: '건', note: top || '입력 없음' },
    {
      label: '바로 답한 질문',
      value: formatRate(d.directRate),
      note: `질문 답변 ${formatInt(data.answer.questions)}건 중 ${formatInt(d.direct)}건`,
    },
    {
      label: '답변 첫 소리까지 (p95)',
      value: formatMs(d.question?.firstAudioP95Ms ?? null),
      note: `질문 기준 · 절반은 ${formatMs(d.question?.firstAudioP50Ms ?? null)} 안`,
    },
    {
      label: '분류 시간 (p95, 가장 느린 종류)',
      value: formatMs(d.slowest?.ms ?? null),
      note: d.slowest
        ? `${slowWarn ? '목표 1.5초 넘음' : '목표 1.5초'} · ${intentLabel(d.slowest.intent)}`
        : '기록 없음',
      warn: slowWarn,
    },
    {
      label: '못 알아들은 입력',
      value: formatRate(d.unknownRate),
      note: `UNKNOWN ${formatInt(d.unknown)}건`,
    },
    {
      label: '장면 찾기 성공',
      value: formatRate(d.seekFoundRate),
      note: `${formatInt(data.seek.total)}건 중 ${formatInt(d.seekFound)}건 찾음`,
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
              {t.unit && (
                <span className="ml-[0.2rem] text-[0.9333rem] font-normal text-ink-muted">
                  {t.unit}
                </span>
              )}
            </dd>
            <dd
              className={cn(
                'mt-[0.2667rem] text-[0.8rem] text-ink-muted',
                t.warn && 'font-bold text-danger',
              )}
            >
              {t.note}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/* ── 비율 막대 + 범례 ── */

interface Part {
  label: string
  count: number
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
        {total > 0 &&
          parts.map(
            (p, i) =>
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
            <b className="tabular-nums">{formatInt(p.count)}건</b>
            <span className="w-[3.4rem] text-right text-ink-muted tabular-nums">
              {formatRate(total === 0 ? 0 : p.count / total)}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

/* ── 질문 답변 결과 ── */

function AnswerResult({ data, d }: { data: ChatStats; d: Derived }) {
  const a = data.answer
  const rates: { label: string; value: string; note: string }[] = [
    {
      label: '바로 못 답한 비율',
      value: formatRate(a.unanswerableRate),
      note: `${formatInt(a.notAnsweredDirectly)} ÷ 질문 ${formatInt(a.questions)}`,
    },
    {
      label: '그중 뒤에 답이 있던 비율',
      value: formatRate(a.futureOfferedRate),
      note: `“들으시겠어요?” ${formatInt(a.futureOffered)} ÷ ${formatInt(a.notAnsweredDirectly)}`,
    },
    {
      label: '물었을 때 들은 비율',
      value: formatRate(a.futureChosenRate),
      note: `들음 ${formatInt(a.futureChosen)} ÷ 물음 ${formatInt(a.futureOffered)}`,
    },
  ]
  return (
    <section aria-labelledby="answer-result-title" className={`${CARD} p-[1.2rem]`}>
      <h2 id="answer-result-title" className="text-[1.0667rem] font-bold">
        질문 답변 결과
      </h2>
      <p className="mt-[0.2rem] text-[0.8667rem] text-ink-muted">
        끝까지 답한 질문 {formatInt(a.questions)}건이 어떻게 끝났는지예요.
        {d.droppedQuestions > 0 &&
          ` 답변 중 끊긴 질문 ${formatInt(d.droppedQuestions)}건(질문 입력 − 답변)은 빠져 있어요.`}
      </p>
      {a.questions === 0 ? (
        <p className="mt-[1rem] text-[0.9333rem]">이 기간에는 질문 답변이 없어요.</p>
      ) : (
        <>
          <SplitBar
            columns={2}
            total={a.questions}
            parts={[
              { label: '바로 답함', count: d.direct, color: 'dark' },
              { label: '뒤에 답이 있어 물음 → 들음', count: a.futureChosen, color: 'mid' },
              { label: '뒤에 답이 있어 물음 → 안 들음', count: d.offeredDeclined, color: 'light' },
              { label: '어디에도 답이 없음', count: d.nowhere, color: 'warn' },
            ]}
          />
          <dl className="mt-[1.2rem] grid grid-cols-3 gap-[0.8667rem] border-t border-line pt-[0.9333rem]">
            {rates.map((r) => (
              <div key={r.label} className="border-l-2 border-line pl-[0.8rem]">
                <dt className="text-[0.8667rem] text-ink-muted">{r.label}</dt>
                <dd className="mt-[0.1333rem] text-[1.2rem] leading-tight font-bold tabular-nums">
                  {r.value}
                </dd>
                <dd className="mt-[0.1333rem] text-[0.8rem] text-ink-muted">{r.note}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}

/* ── 장면 찾기 ── */

function SeekResult({ data }: { data: ChatStats }) {
  const s = data.seek
  return (
    <section aria-labelledby="seek-title" className={`${CARD} p-[1.2rem]`}>
      <h2 id="seek-title" className="text-[1.0667rem] font-bold">
        장면 찾기
      </h2>
      <p className="mt-[0.2rem] text-[0.8667rem] text-ink-muted">
        “빨간 차 나오는 데로 가 줘” 같은 요청 {formatInt(s.total)}건을 어떻게 찾았는지예요. 키워드로
        찾으면 AI를 부르지 않아요.
      </p>
      {s.total === 0 ? (
        <p className="mt-[1rem] text-[0.9333rem]">이 기간에는 장면 찾기가 없어요.</p>
      ) : (
        <SplitBar
          columns={1}
          total={s.total}
          parts={[
            { label: '키워드로 찾음', count: s.keyword, color: 'dark' },
            // rag 는 BE가 주는 경우에만 칸을 보여 준다 (없을 때 0건으로 보이면 오해할 수 있음)
            ...(s.rag != null
              ? [{ label: '의미 검색(RAG)으로 찾음', count: s.rag, color: 'mid' as const }]
              : []),
            { label: 'AI가 골라 찾음', count: s.llm, color: s.rag != null ? 'light' : 'mid' },
            { label: '못 찾음', count: s.notFound, color: 'warn' },
          ]}
        />
      )}
    </section>
  )
}

/* ── 표 ── */

function TableCard({
  id,
  title,
  desc,
  empty,
  children,
}: {
  id: string
  title: string
  desc: string
  empty: boolean
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className={`overflow-hidden ${CARD}`}>
      <h2 id={id} className="px-[1.2rem] pt-[1.2rem] text-[1.0667rem] font-bold">
        {title}
      </h2>
      <p className="px-[1.2rem] pt-[0.2rem] pb-[0.8rem] text-[0.8667rem] text-ink-muted">{desc}</p>
      {empty ? (
        <p className="px-[1.2rem] pb-[1.2rem] text-[0.9333rem]">이 기간에는 기록이 없어요.</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  )
}

function IntentName({ intent }: { intent: string }) {
  const label = intentLabel(intent)
  return (
    <>
      {label}
      {label !== intent && (
        <span className="ml-[0.4rem] font-mono text-[0.8rem] font-normal text-ink-muted">
          {intent}
        </span>
      )}
    </>
  )
}

function IntentTable({ data }: { data: ChatStats }) {
  return (
    <TableCard
      id="intent-title"
      title="입력 종류별"
      desc="입력이 많은 순. 분류 시간은 규칙으로 정하면 거의 0이고, AI가 정하면 길어져요. 목표 p95 1.5초."
      empty={data.byIntent.length === 0}
    >
      <table className="w-full text-[0.9333rem]">
        <thead className="bg-cream text-[0.8667rem] text-ink-muted">
          <tr>
            <th scope="col" className={`${CELL} ${TH}`}>
              종류
            </th>
            <th scope="col" className={`${NUM} ${TH}`}>
              입력
            </th>
            <th scope="col" className={`${NUM} ${TH}`}>
              비중
            </th>
            <th scope="col" className={`${NUM} ${TH}`}>
              분류 p50
            </th>
            <th scope="col" className={`${NUM} ${TH}`}>
              분류 p95
            </th>
          </tr>
        </thead>
        <tbody>
          {data.byIntent.map((i) => (
            <tr key={i.intent} className="border-t border-line">
              <th scope="row" className={`${CELL} font-bold`}>
                <IntentName intent={i.intent} />
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
  const heads = ['답변', '바로 답함', '자료에 없음', '골라 들음', '첫 소리 p50', 'p95']
  return (
    <TableCard
      id="answer-title"
      title="답변 종류별"
      desc="AI가 말로 답한 입력만이에요. 첫 소리는 입력을 받은 뒤 답변 첫 음성이 나오기까지 걸린 시간이에요."
      empty={data.answer.byIntent.length === 0}
    >
      <table className="w-full text-[0.9333rem]">
        <thead className="bg-cream text-[0.8667rem] text-ink-muted">
          <tr>
            <th scope="col" className={`${CELL} ${TH}`}>
              종류
            </th>
            {heads.map((h) => (
              <th key={h} scope="col" className={`${NUM} ${TH}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
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
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-[1.2rem] pt-[1.2rem]">
        <h2 id="unanswered-title" className="text-[1.0667rem] font-bold">
          답이 없던 질문
        </h2>
        {rows.length > 0 && (
          <span className="text-[0.8667rem] text-ink-muted">
            {d.nowhere > rows.length
              ? `${formatInt(d.nowhere)}건 중 최근 ${rows.length}건`
              : `${rows.length}건`}
          </span>
        )}
      </div>
      <p className="px-[1.2rem] pt-[0.2rem] pb-[0.8rem] text-[0.8667rem] text-ink-muted">
        영상 어디에도 답이 없던 질문이에요. 해설을 보완할 후보로 보세요. 질문한 사람 정보는 넣지
        않았어요.
      </p>
      {rows.length === 0 ? (
        <p className="px-[1.2rem] pb-[1.2rem] text-[0.9333rem]">이 기간에는 없어요.</p>
      ) : (
        <div className="max-h-[22rem] overflow-auto">
          <table className="w-full text-[0.9333rem]">
            <thead className="sticky top-0 bg-cream text-[0.8667rem] text-ink-muted">
              <tr>
                <th scope="col" className={`${CELL} ${TH}`}>
                  시각
                </th>
                <th scope="col" className={`${CELL} ${TH}`}>
                  영상
                </th>
                <th scope="col" className={`${NUM} ${TH}`}>
                  영상 시점
                </th>
                <th scope="col" className={`${CELL} ${TH}`}>
                  질문
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.chatLogId} className="border-t border-line">
                  <td className={`${CELL} font-mono text-[0.8667rem] whitespace-nowrap`}>
                    {formatShortDateTime(r.createdAt)}
                  </td>
                  <td className={CELL}>
                    {r.videoId == null ? (
                      <span className="text-ink-muted">(영상 밖에서 물음)</span>
                    ) : (
                      (r.videoTitle ?? `영상 ${r.videoId}`)
                    )}
                  </td>
                  <td className={NUM}>{formatVideoTime(r.videoTimeMs)}</td>
                  <td className={CELL}>{r.utterance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
