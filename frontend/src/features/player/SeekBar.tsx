import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { cn } from '@/components/ui/cn'
import { formatClock, formatPositionSpoken } from '@/utils/time'

export interface SeekBarProps {
  currentMs: number
  durationMs: number
  /** 화살표 한 번에 옮길 초 (재생 설정 '앞뒤 이동 간격') */
  stepSec: number
  onSeek: (ms: number) => void
  /** 키를 뗀 뒤 한 번만 부른다 (화살표를 연달아 눌러도 한 번) */
  onSeekSettled?: (ms: number) => void
  /** 검은 바탕(전체 화면 하단 바) 위에 놓을 때 dark */
  tone?: 'light' | 'dark'
  className?: string
}

/**
 * 직접 만든 재생바 (원칙 5장). role="slider" 에 말로 쓴 aria-valuetext.
 * ← → 는 설정 간격, PgUp/PgDn 은 1분, Home/End 는 처음·끝.
 */
export function SeekBar({
  currentMs,
  durationMs,
  stepSec,
  onSeek,
  onSeekSettled,
  tone = 'light',
  className,
}: SeekBarProps) {
  const dark = tone === 'dark'
  const trackRef = useRef<HTMLDivElement>(null)
  const settleTimer = useRef<number | null>(null)
  const [pending, setPending] = useState<number | null>(null)
  const shown = pending ?? currentMs
  const max = Math.max(1, durationMs)
  const percent = Math.min(100, Math.max(0, (shown / max) * 100))

  /*
   * 낭독기용 값: 포커스가 있는 동안에는 사용자가 옮길 때만 바꾼다.
   * 재생 중 매초 바뀌면 낭독기(NVDA)가 포커스된 슬라이더 값 변화를 계속 읽어 영상 소리와 겹친다 (원칙 2장).
   * 포커스가 들어올 때 지금 위치로 맞춰 읽게 하고, 포커스가 없을 때는 그대로 따라간다
   */
  const [focused, setFocused] = useState(false)
  const [spokenMs, setSpokenMs] = useState(shown)
  const ariaMs = focused ? spokenMs : shown

  const settle = (ms: number) => {
    if (settleTimer.current) window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      setPending(null)
      onSeekSettled?.(ms)
    }, 400)
  }
  useEffect(
    () => () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current)
    },
    [],
  )

  const go = (ms: number) => {
    const next = Math.min(max, Math.max(0, Math.round(ms)))
    setPending(next)
    setSpokenMs(next)
    onSeek(next)
    settle(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = stepSec * 1000
    const map: Record<string, number | undefined> = {
      ArrowLeft: shown - step,
      ArrowDown: shown - step,
      ArrowRight: shown + step,
      ArrowUp: shown + step,
      PageDown: shown - 60_000,
      PageUp: shown + 60_000,
      Home: 0,
      End: max,
    }
    const target = map[e.key]
    if (target === undefined) return
    e.preventDefault()
    go(target)
  }

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    go(((e.clientX - rect.left) / rect.width) * max)
  }

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <p className={cn('shrink-0 font-mono text-lg', dark ? 'text-on-stage' : 'text-ink-muted')}>
        <span aria-hidden="true">
          {formatClock(shown)} / {formatClock(durationMs)}
        </span>
        <span className="sr-only">
          {formatPositionSpoken(shown)}, 전체 {formatPositionSpoken(durationMs)}
        </span>
      </p>
      {/* 트랙은 마우스용, 키보드·낭독기는 슬라이더 역할의 손잡이로 조작한다 */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- 키보드는 아래 슬라이더가 맡는다 */}
      <div
        ref={trackRef}
        onClick={onClick}
        className="relative flex h-14 min-w-0 flex-1 cursor-pointer items-center"
      >
        <div className={cn('h-2.5 w-full rounded-full', dark ? 'bg-cream/40' : 'bg-line')} />
        <div
          role="slider"
          tabIndex={0}
          aria-label="재생 위치"
          aria-valuemin={0}
          aria-valuemax={durationMs}
          aria-valuenow={ariaMs}
          aria-valuetext={`${formatPositionSpoken(ariaMs)}, 전체 ${formatPositionSpoken(durationMs)}`}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setSpokenMs(shown)
            setFocused(true)
          }}
          onBlur={() => setFocused(false)}
          className={cn(
            'absolute top-1/2 h-9 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 bg-yellow outline-offset-4 focus-visible:bg-yellow',
            dark ? 'border-cream' : 'border-navy',
          )}
          style={{ left: `${percent}%` }}
        />
      </div>
    </div>
  )
}
