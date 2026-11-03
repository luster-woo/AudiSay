import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Chapter, NarrationLine, SceneCandidate } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { formatClock, formatPositionSpoken } from '@/utils/time'
import type { HistoryEntry } from './history'

/** 시각 표기. 눈에는 '2:14', 낭독기에는 '2분 14초' */
export function Clock({ ms, className }: { ms: number; className?: string }) {
  return (
    <span className={cn('font-mono', className)}>
      <span aria-hidden="true">{formatClock(ms)}</span>
      <span className="sr-only">{formatPositionSpoken(ms)}</span>
    </span>
  )
}

/* ───────────── 목차 ───────────── */

export function ChaptersPanel({
  chapters,
  currentMs,
  onPick,
}: {
  chapters: Chapter[]
  currentMs: number
  onPick: (c: Chapter) => void
}) {
  const current = [...chapters].reverse().find((c) => c.startMs <= currentMs) ?? null
  return (
    <section aria-labelledby="chapters-title">
      <h2 id="chapters-title" className="text-lg font-bold">
        장면 목차 · {chapters.length}개
      </h2>
      {chapters.length === 0 ? (
        <p className="mt-3 text-ink-muted">목차가 없어요.</p>
      ) : (
        <ul className="mt-3">
          {chapters.map((c) => {
            const isCurrent = c.chapterId === current?.chapterId
            return (
              <li key={c.chapterId}>
                <button
                  type="button"
                  onClick={() => onPick(c)}
                  aria-current={isCurrent ? 'true' : undefined}
                  aria-label={`${c.chapterIndex}번, ${c.title}${isCurrent ? ', 지금' : ''}, ${formatPositionSpoken(c.startMs)}부터`}
                  className={cn(
                    'flex min-h-touch w-full items-center gap-3 rounded-md border-2 px-3 text-left text-lg',
                    // 지금 장면은 진한 노랑 + 검은 테두리로 눈에 띄게. 말로는 aria-label 의 '지금'이 알린다
                    isCurrent
                      ? 'border-ink bg-yellow font-bold'
                      : 'border-transparent hover:bg-cream',
                  )}
                >
                  <span className={cn('w-5 text-right', !isCurrent && 'text-ink-muted')}>
                    {c.chapterIndex}
                  </span>
                  <span className="flex-1">{c.title}</span>
                  <Clock ms={c.startMs} className={cn(!isCurrent && 'text-ink-muted')} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ───────────── 대본 ───────────── */

export function ScriptPanel({
  lines,
  current,
  onPick,
}: {
  lines: NarrationLine[]
  current: NarrationLine | null
  onPick: (l: NarrationLine) => void
}) {
  const listRef = useRef<HTMLUListElement>(null)
  // 지금 문장이 바뀌면 눈에 보이게 따라간다 (포커스는 옮기지 않는다)
  useEffect(() => {
    const list = listRef.current
    const el = current ? list?.querySelector<HTMLElement>(`[data-line="${current.lineId}"]`) : null
    if (!list || !el) return
    // 목록 안에서만 움직인다 (scrollIntoView 는 페이지 전체를 끌어올릴 수 있다)
    const top = el.offsetTop - list.offsetTop
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2 + el.offsetHeight / 2)
    }
  }, [current])

  return (
    <section aria-labelledby="script-title" className="rounded-lg border-2 border-navy p-4">
      <h2 id="script-title" className="text-lg font-bold">
        해설 대본 · {lines.length}문장
      </h2>
      <ul ref={listRef} className="relative mt-3 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
        {lines.map((l) => {
          const isCurrent = l.lineId === current?.lineId
          return (
            <li key={l.lineId} data-line={l.lineId}>
              <button
                type="button"
                onClick={() => onPick(l)}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={`${formatPositionSpoken(l.startMs)}${isCurrent ? ', 지금 문장' : ''}. ${l.text}`}
                className={cn(
                  'w-full rounded-md border-2 px-4 py-3 text-left',
                  isCurrent ? 'border-navy bg-yellow font-bold' : 'border-navy bg-paper',
                )}
              >
                <Clock ms={l.startMs} className="block font-bold" />
                <span className="mt-1 block text-lg leading-snug">{l.text}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ───────────── 질문 기록 + 장면 후보 ───────────── */

const stamp = (who: string, ms: number | null) =>
  ms == null ? who : `${who} · ${formatPositionSpoken(ms)}`

export function HistoryPanel({
  entries,
  onReplay,
  onGoTo,
}: {
  entries: HistoryEntry[]
  onReplay: (e: Extract<HistoryEntry, { kind: 'answer' }>) => void
  onGoTo: (ms: number) => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const last = entries[entries.length - 1]
  const lastKey = last?.key
  const lastText = last?.text
  // 새 항목이 생기거나 답이 이어서 적히면 아래로 따라간다
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [lastKey, lastText])

  return (
    <section aria-labelledby="history-title" className="rounded-lg border-2 border-navy p-4">
      <div className="flex items-baseline justify-between">
        <h2 id="history-title" className="text-lg font-bold">
          질문 기록 · {entries.length}개
        </h2>
        {entries.length > 1 && <p className="text-ink-muted">최근 것이 아래</p>}
      </div>
      {entries.length === 0 ? (
        <p className="mt-3 text-ink-muted">
          아직 질문한 적이 없어요. 위 입력칸에 적거나 말로 물어보세요.
        </p>
      ) : (
        <ol ref={listRef} className="mt-3 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {entries.map((e) => (
            <li
              key={e.key}
              className={cn(
                'rounded-md border-2 px-4 py-3',
                e.kind === 'answer' && 'border-navy bg-yellow',
                e.kind === 'me' && 'border-navy bg-paper',
                e.kind === 'command' && 'border-dashed border-navy bg-paper',
              )}
            >
              <p className="font-bold">
                <span aria-hidden="true">
                  {e.kind === 'me' ? '나' : e.kind === 'answer' ? 'AudiSay 답' : '명령'}
                  {e.videoTimeMs != null && ` · ${formatClock(e.videoTimeMs)}`}
                </span>
                <span className="sr-only">
                  {stamp(
                    e.kind === 'me' ? '나' : e.kind === 'answer' ? 'AudiSay 답' : '명령',
                    e.videoTimeMs,
                  )}
                </span>
              </p>
              <p className={cn('mt-1 text-lg', e.kind === 'answer' && 'font-bold')}>
                {e.text || (e.kind === 'answer' && !e.done ? '답을 만드는 중이에요…' : '')}
              </p>
              {e.kind === 'answer' && e.done && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => onReplay(e)}
                    aria-label={`다시 듣기, ${stamp('AudiSay 답', e.videoTimeMs)}`}
                  >
                    다시 듣기
                  </Button>
                  {e.videoTimeMs != null && (
                    <Button
                      variant="secondary"
                      onClick={() => onGoTo(e.videoTimeMs!)}
                      aria-label={`그 장면 보기, ${formatPositionSpoken(e.videoTimeMs)}`}
                    >
                      그 장면 보기
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * 말로 장면 이동이 애매할 때 후보를 고르는 화면 (NAV-05, 원칙 5·9장).
 * 라디오 그룹: ↑ ↓ 로 고르고 Enter 로 이동. '둘 다 아니에요' 는 따로 버튼.
 */
export function CandidatesPanel({
  utterance,
  videoTimeMs,
  candidates,
  onChoose,
  onNone,
}: {
  utterance: string
  videoTimeMs: number | null
  candidates: SceneCandidate[]
  onChoose: (c: SceneCandidate) => void
  onNone: () => void
}) {
  const firstRef = useRef<HTMLButtonElement>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [chosen, setChosen] = useState(0)
  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  const onKey = (e: KeyboardEvent, i: number) => {
    const n = candidates.length
    let next: number | null = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % n
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + n) % n
    if (next === null) return
    e.preventDefault()
    setChosen(next)
    refs.current[next]?.focus()
  }

  return (
    <section aria-labelledby="cands-title" className="rounded-lg border-2 border-navy p-4">
      <h2 id="cands-title" className="text-lg font-bold">
        장면 찾기 · 후보 {candidates.length}곳
      </h2>
      <div className="mt-3 rounded-md border-2 border-navy bg-paper px-4 py-3">
        <p className="font-bold">{stamp('나', videoTimeMs)}</p>
        <p className="mt-1 text-lg">{utterance}</p>
      </div>
      <div className="mt-3 rounded-md border-2 border-navy bg-yellow px-4 py-3">
        <p className="font-bold">AudiSay 답</p>
        <p className="mt-1 text-lg font-bold">
          비슷한 장면이 {candidates.length}곳 있어요. 번호를 고르세요.
        </p>
      </div>
      <div role="radiogroup" aria-label="장면 후보" className="mt-3 space-y-3">
        {candidates.map((c, i) => {
          const checked = i === chosen
          return (
            <button
              key={c.chapterId}
              ref={(el) => {
                refs.current[i] = el
                if (i === 0) firstRef.current = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onChoose(c)
                  return
                }
                onKey(e, i)
              }}
              onClick={() => onChoose(c)}
              className={cn(
                'w-full rounded-md border-2 border-navy px-4 py-3 text-left',
                checked ? 'bg-yellow-soft' : 'bg-paper',
              )}
            >
              <span className="block font-bold">
                <span aria-hidden="true">{checked ? '● ' : '○ '}</span>
                {i + 1} · {c.title} · <Clock ms={c.startMs} />
              </span>
              <span className="mt-1 block text-lg">{c.summary}</span>
            </button>
          )
        })}
      </div>
      <Button variant="secondary" size="xl" onClick={onNone} className="mt-3 w-full">
        둘 다 아니에요, 다시 말할게요
      </Button>
      <p className="mt-3 text-ink-muted">위·아래 화살표로 고르고 Enter로 이동해요.</p>
    </section>
  )
}
