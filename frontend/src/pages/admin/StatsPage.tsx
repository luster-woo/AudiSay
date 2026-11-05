import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { toUserMessage } from '@/api/errors'
import { queryKeys } from '@/api/queryKeys'
import type { AiUsageStats } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { DailyChart } from '@/features/admin/DailyChart'
import { DateRangePicker } from '@/features/admin/DateRangePicker'
import { Segmented } from '@/features/admin/Segmented'
import {
  DAILY_METRICS,
  type DailyMetric,
  formatCredits,
  formatDayLong,
  formatInt,
  formatLatency,
  formatRate,
  isSelfHosted,
  MAX_RANGE_DAYS,
  presetRange,
  purposeLabel,
  RANGE_PRESETS,
  todayKst,
  type RangePreset,
} from '@/features/admin/stats'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'

/** 표 칸 안쪽 여백 (Figma 12px) */
const CELL = 'px-[0.8rem] py-[0.6rem] text-left'
const NUM = `${CELL} text-right whitespace-nowrap tabular-nums`
const TH = 'font-normal'

/** 통계 (ADM-04): AI 호출 수·토큰·크레딧이 기간 동안 어디에 쓰였는지 본다 */
export default function StatsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { announce } = useAnnouncer()

  const [preset, setPreset] = useState<RangePreset | null>('30d')
  const [range, setRange] = useState(() => presetRange('30d'))
  const [metric, setMetric] = useState<DailyMetric>('credits')
  const [asTable, setAsTable] = useState(false)

  const { data, error, isError, isFetching } = useQuery({
    queryKey: queryKeys.admin.aiUsage(range.from, range.to),
    queryFn: () => adminApi.aiUsage(range.from, range.to),
    placeholderData: keepPreviousData,
  })

  usePageEntry({
    title: '통계',
    announce: '통계 화면이에요. 기간을 골라 AI 사용량을 볼 수 있어요.',
    focusRef: headingRef,
    ready: data !== undefined || isError,
  })

  // 기간을 바꾸면 결과가 도착한 뒤 요약을 읽어 준다
  const pendingAnnounce = useRef(false)
  useEffect(() => {
    if (!pendingAnnounce.current || isFetching) return
    if (data) {
      pendingAnnounce.current = false
      announce(
        `${formatDayLong(data.from)}부터 ${formatDayLong(data.to)}까지, 호출 ${formatInt(data.summary.calls)}건, 크레딧 ${formatCredits(data.summary.estimatedCredits)}.`,
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
    // 고른 기간이 프리셋과 같으면 그 프리셋을 켜 둔다
    setPreset(
      RANGE_PRESETS.find((p) => {
        const r = presetRange(p.value)
        return r.from === next.from && r.to === next.to
      })?.value ?? null,
    )
    applyRange(next)
  }

  // 치수는 다른 관리자 화면과 맞춤 (관리자 글자 크기 15px = 1rem)
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-[1.4667rem] leading-snug font-bold outline-none"
          >
            통계
          </h1>
        </div>
      </div>

      {/* 기간 고르기 */}
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
        <p className="mt-[1.4667rem] rounded-sm border border-line bg-paper px-[0.8rem] py-6">
          통계를 불러오지 못했어요. {toUserMessage(error)}
        </p>
      ) : !data ? (
        <p className="mt-[1.4667rem] rounded-sm border border-line bg-paper px-[0.8rem] py-6">
          통계를 불러오는 중이에요.
        </p>
      ) : (
        <div className={cn('transition-opacity', isFetching && 'opacity-60')}>
          <SummaryTiles data={data} />

          {/* 날짜별 */}
          <section
            aria-labelledby="daily-title"
            className="mt-[1.4667rem] rounded-sm border border-line bg-paper p-[1.2rem]"
          >
            <div className="flex flex-wrap items-center justify-between gap-[0.8667rem]">
              <h2 id="daily-title" className="text-[1.0667rem] font-bold">
                날짜별
              </h2>
              <div className="flex items-center gap-[0.8667rem]">
                <Segmented
                  legend="보여 줄 값"
                  hideLegend
                  options={DAILY_METRICS}
                  value={metric}
                  onChange={setMetric}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  aria-pressed={asTable}
                  onClick={() => setAsTable((v) => !v)}
                  className="min-h-[2.5333rem] px-[1rem]"
                >
                  표로 보기
                </Button>
              </div>
            </div>
            {asTable ? (
              <DailyTable data={data} metric={metric} />
            ) : (
              <div className="mt-[1rem]">
                <DailyChart daily={data.daily} metric={metric} />
                <p className="sr-only">
                  그림은 날짜별 {DAILY_METRICS.find((m) => m.value === metric)?.label} 막대예요.
                  같은 내용을 &apos;표로 보기&apos;에서 읽을 수 있어요.
                </p>
              </div>
            )}
          </section>

          <div className="mt-[1.4667rem] grid gap-[1.4667rem] xl:grid-cols-[3fr_2fr]">
            <PurposeTable data={data} />
            <ModelTable data={data} />
          </div>

          <ReuseSection data={data} />
        </div>
      )}
    </div>
  )
}

/* ── 요약 ── */

function SummaryTiles({ data }: { data: AiUsageStats }) {
  const s = data.summary
  const tiles: { label: string; value: string; note?: string; warn?: boolean }[] = [
    { label: '호출 수', value: formatInt(s.calls), note: '건' },
    { label: '추정 크레딧', value: formatCredits(s.estimatedCredits) },
    { label: '입력 토큰', value: formatInt(s.inputTokens) },
    { label: '출력 토큰', value: formatInt(s.outputTokens) },
    {
      label: '오류율',
      value: formatRate(s.errorRate),
      warn: s.errorRate >= 0.05,
    },
    {
      label: '대체 응답 비율',
      value: formatRate(s.fallbackRate),
      warn: s.fallbackRate >= 0.1,
    },
  ]
  return (
    <section aria-label="기간 요약" className="mt-[1.4667rem]">
      <dl className="grid grid-cols-3 gap-[0.8667rem] xl:grid-cols-6">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={cn(
              'rounded-sm border border-line bg-paper px-[1rem] py-[0.8667rem]',
              t.warn && 'border-danger',
            )}
          >
            <dt className="text-[0.8667rem] text-ink-muted">{t.label}</dt>
            <dd className="mt-[0.2667rem] text-[1.4667rem] leading-tight font-bold tabular-nums">
              {t.value}
              {t.note === '건' && (
                <span className="ml-[0.2rem] text-[0.9333rem] font-normal text-ink-muted">건</span>
              )}
            </dd>
            {t.warn && (
              <dd className="mt-[0.2667rem] text-[0.8rem] font-bold text-danger">
                살펴볼 만큼 높아요
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  )
}

/* ── 날짜별 표 ── */

function DailyTable({ data, metric }: { data: AiUsageStats; metric: DailyMetric }) {
  // 그림에서 고른 값의 칸을 굵게
  const hot = (m: DailyMetric) => (m === metric ? 'font-bold' : '')
  return (
    <div className="mt-[1rem] max-h-[22rem] overflow-y-auto rounded-sm border border-line">
      <table className="w-full text-[0.9333rem]">
        <caption className="sr-only">날짜별 AI 사용량</caption>
        <thead className="sticky top-0 bg-cream text-[0.8667rem] text-ink-muted">
          <tr>
            <th scope="col" className={`${CELL} ${TH}`}>
              날짜
            </th>
            <th scope="col" className={`${NUM} ${TH}`}>
              호출
            </th>
            <th scope="col" className={`${NUM} ${TH}`}>
              입력 토큰
            </th>
            <th scope="col" className={`${NUM} ${TH}`}>
              출력 토큰
            </th>
            <th scope="col" className={`${NUM} ${TH}`}>
              크레딧
            </th>
          </tr>
        </thead>
        <tbody>
          {data.daily.map((d) => (
            <tr key={d.date} className="border-t border-line">
              <th scope="row" className={`${CELL} font-mono font-normal`}>
                {d.date}
              </th>
              <td className={`${NUM} ${hot('calls')}`}>{formatInt(d.calls)}</td>
              <td className={`${NUM} ${hot('tokens')}`}>{formatInt(d.inputTokens)}</td>
              <td className={`${NUM} ${hot('tokens')}`}>{formatInt(d.outputTokens)}</td>
              <td className={`${NUM} ${hot('credits')}`}>{formatCredits(d.estimatedCredits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── 용도별 ── */

function PurposeTable({ data }: { data: AiUsageStats }) {
  const total = data.summary.estimatedCredits || 1
  return (
    <section
      aria-labelledby="purpose-title"
      className="overflow-hidden rounded-sm border border-line bg-paper"
    >
      <h2
        id="purpose-title"
        className="px-[1.2rem] pt-[1.2rem] pb-[0.8rem] text-[1.0667rem] font-bold"
      >
        용도별
      </h2>
      {data.byPurpose.length === 0 ? (
        <p className="px-[1.2rem] pb-[1.2rem] text-[0.9333rem] text-ink-muted">기록 없음</p>
      ) : (
        <table className="w-full text-[0.9333rem]">
          <thead className="bg-cream text-[0.8667rem] text-ink-muted">
            <tr>
              <th scope="col" className={`${CELL} ${TH}`}>
                용도
              </th>
              <th scope="col" className={`${NUM} ${TH}`}>
                호출
              </th>
              <th scope="col" className={`${NUM} ${TH}`}>
                크레딧
              </th>
              <th scope="col" className={`${NUM} ${TH}`}>
                비중
              </th>
              <th scope="col" className={`${NUM} ${TH}`}>
                입력 토큰
              </th>
              <th scope="col" className={`${NUM} ${TH}`}>
                출력 토큰
              </th>
              <th scope="col" className={`${NUM} ${TH}`}>
                오류율
              </th>
              <th scope="col" className={`${NUM} ${TH}`}>
                p50
              </th>
              <th scope="col" className={`${NUM} ${TH}`}>
                p95
              </th>
            </tr>
          </thead>
          <tbody>
            {data.byPurpose.map((p) => (
              <tr key={p.purpose} className="border-t border-line">
                <th scope="row" className={`${CELL} font-bold`}>
                  {purposeLabel(p.purpose)}
                </th>
                <td className={NUM}>{formatInt(p.calls)}</td>
                <td className={`${NUM} font-bold`}>{formatCredits(p.estimatedCredits)}</td>
                <td className={NUM}>{formatRate(p.estimatedCredits / total)}</td>
                <td className={NUM}>{formatInt(p.inputTokens)}</td>
                <td className={NUM}>{formatInt(p.outputTokens)}</td>
                <td className={cn(NUM, p.errorRate >= 0.05 && 'font-bold text-danger')}>
                  {formatRate(p.errorRate)}
                </td>
                <td className={NUM}>{formatLatency(p.p50LatencyMs)}</td>
                <td className={NUM}>{formatLatency(p.p95LatencyMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/* ── 모델별 ── */

function ModelTable({ data }: { data: AiUsageStats }) {
  return (
    <section
      aria-labelledby="model-title"
      className="overflow-hidden rounded-sm border border-line bg-paper"
    >
      <h2
        id="model-title"
        className="px-[1.2rem] pt-[1.2rem] pb-[0.8rem] text-[1.0667rem] font-bold"
      >
        모델별
      </h2>
      {data.byModel.length === 0 ? (
        <p className="px-[1.2rem] pb-[1.2rem] text-[0.9333rem] text-ink-muted">기록 없음</p>
      ) : (
        <table className="w-full text-[0.9333rem]">
          <thead className="bg-cream text-[0.8667rem] text-ink-muted">
            <tr>
              <th scope="col" className={`${CELL} ${TH}`}>
                모델
              </th>
              <th scope="col" className={`${NUM} ${TH}`}>
                호출
              </th>
              <th scope="col" className={`${NUM} ${TH}`}>
                토큰
              </th>
              <th scope="col" className={`${NUM} ${TH}`}>
                크레딧
              </th>
            </tr>
          </thead>
          <tbody>
            {data.byModel.map((m) => (
              <tr key={m.model} className="border-t border-line">
                <th scope="row" className={`${CELL} font-mono text-[0.8667rem] font-normal`}>
                  {m.model}
                  {isSelfHosted(m.model) && (
                    <span className="ml-[0.4rem] rounded-sm bg-cream px-[0.4rem] font-sans text-[0.8rem] text-ink-muted">
                      자체 서버
                    </span>
                  )}
                </th>
                <td className={NUM}>{formatInt(m.calls)}</td>
                <td className={NUM}>{formatInt(m.inputTokens + m.outputTokens)}</td>
                <td className={`${NUM} font-bold`}>
                  {isSelfHosted(m.model) ? '0' : formatCredits(m.estimatedCredits)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/* ── 재사용 효과 ── */

function ReuseSection({ data }: { data: AiUsageStats }) {
  const r = data.reuse
  const items: { label: string; value: string }[] = [
    { label: '새로 만든 해설', value: `${formatInt(r.newJob)}건` },
    { label: '이미 있는 해설 재사용', value: `${formatInt(r.reused)}건` },
    { label: '만드는 중인 해설에 합류', value: `${formatInt(r.joinedJob)}건` },
    { label: '영상당 평균 크레딧', value: formatCredits(r.avgCreditsPerVideo) },
    { label: '아낀 크레딧', value: formatCredits(r.savedCredits) },
    { label: '절감률', value: formatRate(r.savedRate) },
  ]
  return (
    <section
      aria-labelledby="reuse-title"
      className="mt-[1.4667rem] rounded-sm border border-line bg-paper p-[1.2rem]"
    >
      <h2 id="reuse-title" className="text-[1.0667rem] font-bold">
        해설 재사용 효과
      </h2>
      <dl className="mt-[1rem] grid grid-cols-3 gap-[0.8667rem] xl:grid-cols-6">
        {items.map((it) => (
          <div key={it.label} className="border-l-2 border-line pl-[0.8rem]">
            <dt className="text-[0.8667rem] text-ink-muted">{it.label}</dt>
            <dd className="mt-[0.2rem] text-[1.2rem] leading-tight font-bold tabular-nums">
              {it.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
