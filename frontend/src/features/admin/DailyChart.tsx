import { useId, useState } from 'react'
import type { AiUsageDaily } from '@/api/types'
import { cn } from '@/components/ui/cn'
import {
  type DailyMetric,
  formatCompact,
  formatDayLabel,
  formatDayLong,
  formatInt,
  formatMetric,
  metricValue,
} from './stats'

const METRIC_UNIT: Record<DailyMetric, string> = {
  credits: '크레딧',
  calls: '건',
  tokens: '토큰',
}

/* 그림 치수 (viewBox 단위 = px) */
const W = 960
const H = 260
const PAD = { top: 12, right: 8, bottom: 28, left: 52 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
const GAP = 2
const RADIUS = 4

/** 0 ~ max 를 4칸으로 나눌 때 보기 좋은 눈금 간격 */
function niceStep(max: number): number {
  if (max <= 0) return 1
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / mag
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10
  return nice * mag
}

/** 위가 둥근 막대. 아래는 기준선에 붙는다 */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h)
  const bottom = y + h
  return [
    `M${x},${bottom}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${bottom}`,
    'Z',
  ].join(' ')
}

export interface DailyChartProps {
  daily: AiUsageDaily[]
  metric: DailyMetric
}

/**
 * 날짜별 막대 그림 (한 계열). 마우스를 올리면 그 날 값을 보여 준다.
 * 눈으로 보는 운영자용이라 그림 자체는 낭독기에서 숨기고, 같은 내용은 '표로 보기'에서 읽는다.
 */
export function DailyChart({ daily, metric }: DailyChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const clipId = useId()

  const values = daily.map((d) => metricValue(d, metric))
  const step = niceStep(Math.max(...values, 0))
  const top = Math.max(step * 4, step * Math.ceil(Math.max(...values, 0) / step))
  const ticks = [0, 1, 2, 3, 4].map((i) => i * (top / 4))
  const n = daily.length
  const slot = n ? PLOT_W / n : PLOT_W
  const barW = Math.max(1, slot - GAP)
  const y = (v: number) => PAD.top + PLOT_H - (top ? (v / top) * PLOT_H : 0)

  // 날짜 라벨은 겹치지 않게 8개쯤만
  const every = Math.max(1, Math.ceil(n / 8))
  const hovered = hover == null ? null : daily[hover]

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        aria-hidden="true"
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={0} width={PLOT_W} height={H} />
          </clipPath>
        </defs>
        {/* 눈금선·값 */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? 'stroke-ink-muted/60' : 'stroke-line'}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-ink-muted text-[11px]"
            >
              {formatCompact(t)}
            </text>
          </g>
        ))}
        {/* 막대 */}
        <g clipPath={`url(#${clipId})`}>
          {daily.map((d, i) => {
            const x = PAD.left + i * slot + GAP / 2
            const v = values[i]
            const h = Math.max(v > 0 ? 1 : 0, PAD.top + PLOT_H - y(v))
            return (
              <g key={d.date} onPointerEnter={() => setHover(i)}>
                {/* 손이 닿는 영역은 막대보다 넓게 (칸 전체) */}
                <rect
                  x={PAD.left + i * slot}
                  y={PAD.top}
                  width={slot}
                  height={PLOT_H}
                  className={cn('fill-transparent', hover === i && 'fill-yellow-soft')}
                />
                {h > 0 && (
                  <path
                    d={barPath(x, PAD.top + PLOT_H - h, barW, h)}
                    className={hover === i ? 'fill-navy-deep' : 'fill-navy'}
                  />
                )}
              </g>
            )
          })}
        </g>
        {/* 날짜 */}
        {daily.map((d, i) =>
          i % every === 0 ? (
            <text
              key={d.date}
              x={PAD.left + i * slot + slot / 2}
              y={H - 8}
              textAnchor="middle"
              className="fill-ink-muted text-[11px]"
            >
              {formatDayLabel(d.date)}
            </text>
          ) : null,
        )}
      </svg>

      {hovered && hover != null && (
        <div
          role="presentation"
          className={cn(
            'pointer-events-none absolute top-0 w-max rounded-sm border border-line bg-paper px-[0.8rem] py-[0.5333rem] text-[0.8667rem] shadow-sm',
            hover < n / 2 ? 'translate-x-2' : '-translate-x-[calc(100%+0.5rem)]',
          )}
          style={{ left: `${((PAD.left + (hover + (hover < n / 2 ? 1 : 0)) * slot) / W) * 100}%` }}
        >
          <p className="text-ink-muted">{formatDayLong(hovered.date)}</p>
          <p className="font-bold">
            {formatMetric(values[hover], metric)} {METRIC_UNIT[metric]}
          </p>
          {metric === 'tokens' && (
            <p className="text-ink-muted">
              입력 {formatInt(hovered.inputTokens)} · 출력 {formatInt(hovered.outputTokens)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
