import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { rangeDays } from './stats'

export interface DateRange {
  from: string
  to: string
}

export interface DateRangePickerProps {
  value: DateRange
  /** 고를 수 있는 마지막 날 (오늘, KST "YYYY-MM-DD") */
  max: string
  /** 한 번에 고를 수 있는 최대 날짜 수 (양끝 포함) */
  maxDays: number
  onApply: (range: DateRange) => void
  className?: string
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const parts = (date: string) => date.split('-').map(Number) as [number, number, number]
const weekday = (date: string) => {
  const [y, m, d] = parts(date)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** "2026-11-03" → "11월 3일(화)". 연도가 다르면 앞에 연도를 붙인다 */
function shortLabel(date: string, withYear = false) {
  const [y, m, d] = parts(date)
  return `${withYear ? `${y}년 ` : ''}${m}월 ${d}일(${WEEKDAYS[weekday(date)]})`
}

/** 한 달 칸: 앞쪽 빈칸(null) + 그 달 날짜들, 7칸씩 끊는다 */
function monthWeeks(year: number, month: number): (string | null)[][] {
  const first = ymd(year, month, 1)
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: (string | null)[] = Array.from({ length: weekday(first) }, () => null)
  for (let d = 1; d <= count; d++) cells.push(ymd(year, month, d))
  while (cells.length % 7) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

function shiftMonth(year: number, month: number, delta: number) {
  const t = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 }
}

/**
 * 기간 고르기: 버튼을 누르면 달력이 열리고, 날짜 두 개를 차례로 눌러 시작과 끝을 한 번에 정한다.
 * - 첫 번째 누른 날 = 시작, 두 번째 = 끝 (시작보다 앞을 누르면 그 날이 새 시작)
 * - 시작을 고른 뒤에는 최대 날짜 수를 넘는 날과 오늘 뒤는 누를 수 없다
 * - '확인'을 눌러야 조회한다. Esc·바깥 클릭은 바꾸지 않고 닫는다
 */
export function DateRangePicker({ value, max, maxDays, onApply, className }: DateRangePickerProps) {
  const dialogId = useId()
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<{ from: string; to: string | null }>(value)
  const [hover, setHover] = useState<string | null>(null)
  const [view, setView] = useState(() => {
    const [y, m] = parts(value.to)
    return { year: y, month: m }
  })

  const openPicker = () => {
    setDraft(value)
    setHover(null)
    const [y, m] = parts(value.to)
    setView({ year: y, month: m })
    setOpen(true)
  }
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  // 바깥을 누르거나 Esc 면 닫는다
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const picking = draft.to === null
  const lastAllowed = (date: string) => {
    if (date > max) return false
    if (picking && date >= draft.from && rangeDays(draft.from, date) > maxDays) return false
    return true
  }

  const pick = (date: string) => {
    if (!picking || date < draft.from) {
      setDraft({ from: date, to: null })
      return
    }
    setDraft({ from: draft.from, to: date })
  }

  // 칠할 범위: 끝까지 골랐으면 그 범위, 시작만 골랐으면 마우스가 있는 날까지 미리 보기
  const shownTo = draft.to ?? (hover && hover >= draft.from ? hover : draft.from)
  const inRange = (date: string) => date >= draft.from && date <= shownTo
  const single = draft.from === shownTo

  const [maxY, maxM] = parts(max)
  const atLastMonth = view.year > maxY || (view.year === maxY && view.month >= maxM)
  const weeks = monthWeeks(view.year, view.month)

  const days = rangeDays(value.from, value.to)
  const crossYear = parts(value.from)[0] !== parts(value.to)[0]

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <span className="block text-[0.8667rem] text-ink-muted" aria-hidden="true">
        직접 고르기
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={`기간 직접 고르기, ${shortLabel(value.from, crossYear)}부터 ${shortLabel(value.to, crossYear)}까지 ${days}일`}
        onClick={() => (open ? close() : openPicker())}
        className={cn(
          'mt-[0.5333rem] flex h-[2.5333rem] min-h-0 items-center gap-[0.6667rem] rounded-sm border-2 bg-paper px-[0.8rem] text-[0.9333rem]',
          open ? 'border-ink' : 'border-ink-muted/70',
        )}
      >
        <CalendarIcon />
        <span className="font-bold tabular-nums">
          {shortLabel(value.from, crossYear)}
          <span className="px-[0.4rem] text-ink-muted">–</span>
          {shortLabel(value.to, crossYear)}
        </span>
      </button>

      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-labelledby={titleId}
          className="absolute top-full left-0 z-30 mt-[0.4rem] w-[20.5rem] rounded-md border border-line bg-paper p-[1rem] shadow-lg"
        >
          <div className="flex items-center justify-between">
            <MonthButton
              label="이전 달"
              onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
            >
              ‹
            </MonthButton>
            <h3 id={titleId} className="text-[1rem] font-bold" aria-live="polite">
              {view.year}년 {view.month}월
            </h3>
            <MonthButton
              label="다음 달"
              disabled={atLastMonth}
              onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
            >
              ›
            </MonthButton>
          </div>

          <table className="mt-[0.6667rem] w-full table-fixed border-collapse text-[0.9333rem]">
            <thead>
              <tr>
                {WEEKDAYS.map((w, i) => (
                  <th
                    key={w}
                    scope="col"
                    className={cn(
                      'pb-[0.4rem] text-[0.8rem] font-normal',
                      i === 0 ? 'text-danger' : 'text-ink-muted',
                    )}
                  >
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody onPointerLeave={() => setHover(null)}>
              {weeks.map((week, wi) => (
                <tr key={wi}>
                  {week.map((date, di) => {
                    if (!date) return <td key={di} />
                    const isStart = date === draft.from
                    const isEnd = date === shownTo
                    const inside = inRange(date)
                    const allowed = lastAllowed(date)
                    const isToday = date === max
                    return (
                      <td key={date} className="p-0 py-[0.1333rem]">
                        {/* 범위 띠는 날짜 칸과 같은 높이로 칠한다. 시작 칸은 오른쪽 반, 끝 칸은 왼쪽 반만 */}
                        <div
                          className={cn(
                            'flex h-[2.3333rem] items-center justify-center',
                            inside && !single && !isStart && !isEnd && 'bg-[#eaf0fb]',
                            inside &&
                              !single &&
                              isStart &&
                              'bg-linear-to-r from-transparent from-50% to-[#eaf0fb] to-50%',
                            inside &&
                              !single &&
                              isEnd &&
                              'bg-linear-to-r from-[#eaf0fb] from-50% to-transparent to-50%',
                          )}
                        >
                          <button
                            type="button"
                            disabled={!allowed}
                            aria-pressed={isStart || date === draft.to}
                            aria-label={`${parts(date)[0]}년 ${parts(date)[1]}월 ${parts(date)[2]}일 ${WEEKDAYS[weekday(date)]}요일${isToday ? ', 오늘' : ''}`}
                            onClick={() => pick(date)}
                            onPointerEnter={() => setHover(date)}
                            className={cn(
                              'flex size-[2.3333rem] min-h-0 items-center justify-center rounded-sm tabular-nums',
                              isStart || isEnd
                                ? 'bg-navy font-bold text-paper'
                                : allowed
                                  ? 'text-ink hover:bg-cream'
                                  : 'cursor-not-allowed text-ink-muted/40',
                              isToday &&
                                !(isStart || isEnd) &&
                                'font-bold underline underline-offset-4',
                            )}
                          >
                            {parts(date)[2]}
                          </button>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-[0.8rem] flex justify-end">
            <Button
              size="sm"
              disabled={!draft.to}
              onClick={() => {
                if (!draft.to) return
                onApply({ from: draft.from, to: draft.to })
                close()
              }}
              className="px-[1rem]"
            >
              확인
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function MonthButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-[2.2rem] min-h-0 items-center justify-center rounded-sm text-[1.3rem] text-ink hover:bg-cream disabled:cursor-not-allowed disabled:text-ink-muted/30 disabled:hover:bg-transparent"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  )
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-[1.1rem] shrink-0" fill="none">
      <rect x="2.5" y="4" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.5 8h15M6.5 2.5v3M13.5 2.5v3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
