import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { Chapter, NarrationLine, SceneCandidate } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { formatClock, formatPositionSpoken } from '@/utils/time'
import type { HistoryEntry } from './history'
import type { FutureOffer } from './useAsk'

/** 시각 표기. 눈에는 '2:14', 낭독기에는 '2분 14초' */
export function Clock({ ms, className }: { ms: number; className?: string }) {
  return (
    <span className={cn('font-mono', className)}>
      <span aria-hidden="true">{formatClock(ms)}</span>
      <span className="sr-only">{formatPositionSpoken(ms)}</span>
    </span>
  )
}

/**
 * 눈에는 ' · ', 낭독기에는 쉼표. 가운뎃점(·)은 낭독기 기호 읽기 수준에 따라 "가운뎃점"으로 읽힌다 (원칙 11장)
 */
function Dot() {
  return (
    <>
      <span aria-hidden="true"> · </span>
      <span className="sr-only">, </span>
    </>
  )
}

/** 패널 글자는 단어 단위로 줄을 바꾼다 (띄어쓰기 없는 아주 긴 글자만 어디서든 끊는다). 안쪽 글자에 그대로 이어진다 */
const WRAP = 'break-keep [overflow-wrap:anywhere]'

/* ───────────── 목차·대본: 같은 줄 모양 ───────────── */

/** 목차·대본 목록의 공통 틀. 제목 아래 목록이 길면 목록 안에서만 스크롤한다 (바깥 여백은 포커스 테두리 자리) */
const LIST_TITLE = 'text-base font-bold text-ink-muted'
const LIST = 'relative mt-3 max-h-[26rem] space-y-2 overflow-y-auto p-1.5'

/**
 * 지금 항목이 바뀌면 목록 안에서 보이게 따라간다 (포커스는 옮기지 않는다).
 * 지금 항목이 목록에서(또는 브라우저 창에서) 조금이라도 벗어나 있으면 목록 맨 위로 올린다
 */
function useFollowCurrent<T extends HTMLElement>(currentKey: string | number | undefined) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const list = ref.current
    const el =
      currentKey == null ? null : list?.querySelector<HTMLElement>(`[data-key="${currentKey}"]`)
    if (!list || !el) return
    // 화면 위치로 잰다. 목록이 relative 라 offsetTop 은 이미 목록 기준이어서 빼면 엉뚱한 곳으로 간다
    const box = list.getBoundingClientRect()
    const row = el.getBoundingClientRect()
    const visibleTop = Math.max(box.top, 0)
    const visibleBottom = Math.min(box.bottom, window.innerHeight)
    if (row.top < visibleTop || row.bottom > visibleBottom) {
      // 목록 안에서만 움직인다 (scrollIntoView 는 페이지 전체를 끌어올릴 수 있다)
      list.scrollTop += row.top - box.top
    }
  }, [currentKey])
  return ref
}

/**
 * 목차·대본 목록을 Tab 한 번에 지나가게 한다 (roving tabindex).
 * Tab 은 목록 안 한 줄에만 멈추고, 줄 사이는 ↑ ↓ Home End 로 옮긴다. 누르면(Enter·Space) 그 시각으로 간다.
 * 목록 밖에서 들어오면 '지금' 줄에 멈춘다(없으면 첫 줄). 목록 안에서 옮긴 동안에는 옮긴 줄을 기억한다
 */
function useRovingRows(keys: (string | number)[], currentKey: string | number | undefined) {
  const [focusKey, setFocusKey] = useState<string | number | null>(null)
  const stopKey =
    focusKey != null && keys.includes(focusKey) ? focusKey : (currentKey ?? keys[0] ?? null)

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const list = e.currentTarget
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>('[data-row]'))
    const i = rows.findIndex((r) => r === document.activeElement)
    if (i < 0) return
    const next =
      e.key === 'ArrowDown'
        ? Math.min(rows.length - 1, i + 1)
        : e.key === 'ArrowUp'
          ? Math.max(0, i - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? rows.length - 1
              : null
    if (next === null) return
    e.preventDefault()
    rows[next].focus()
  }
  // 목록 안 줄에 포커스가 오면 그 줄을 Tab 자리로. 목록을 떠나면 다시 '지금' 줄을 따라간다
  const onFocus = (e: FocusEvent<HTMLUListElement>) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key
    if (key == null) return
    setFocusKey(keys.find((k) => String(k) === key) ?? null)
  }
  const onBlur = (e: FocusEvent<HTMLUListElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusKey(null)
  }
  return { stopKey, listProps: { onKeyDown, onFocus, onBlur } }
}

/**
 * 목차·대본이 함께 쓰는 한 줄: 왼쪽 시각, 오른쪽 글. 누르면 그 시각으로 간다.
 * 지금 위치는 노란 바탕 + 검은 테두리 + 굵은 글자 (색만이 아니라 테두리·굵기로도). 말로는 aria-label 이 알린다.
 * 포커스가 있는 동안에는 낭독기용 이름·'지금' 표시를 포커스가 들어온 때 그대로 둔다:
 * 재생 중 '지금'이 옮겨 가며 이름이 바뀌면 낭독기가 바뀐 이름을 읽어 해설·영상 소리와 겹친다 (원칙 1장. 재생바와 같은 방식).
 * 눈에 보이는 노란 표시는 그대로 따라간다
 */
function TimeRow({
  ms,
  current,
  label,
  tabStop,
  onClick,
  children,
}: {
  ms: number
  current: boolean
  label: string
  /** 목록에서 Tab 이 멈출 줄이면 true (한 목록에 하나) */
  tabStop: boolean
  onClick: () => void
  children: ReactNode
}) {
  const [frozen, setFrozen] = useState<{ label: string; current: boolean } | null>(null)
  const spoken = frozen ?? { label, current }
  return (
    <button
      type="button"
      data-row
      tabIndex={tabStop ? 0 : -1}
      // 눌러서 이 줄이 '지금'이 되어도 이름은 그대로 둔다 (옮긴 위치는 안내 전광판이 알린다). 다음에 들어올 때 새로 맞춘다
      onClick={onClick}
      onFocus={() => setFrozen({ label, current })}
      onBlur={() => setFrozen(null)}
      aria-current={spoken.current ? 'true' : undefined}
      aria-label={spoken.label}
      className={cn(
        'flex min-h-touch w-full items-center rounded-lg border-2 px-4 py-3 text-left',
        current ? 'border-ink bg-yellow font-bold' : 'border-line bg-paper hover:border-navy',
      )}
    >
      {/* 한 줄이면 줄 전체가 세로 가운데, 여러 줄이면 시각은 첫 줄 높이에 붙는다.
          시각의 줄 높이를 글(text-lg · leading-snug)과 같게 맞춰 두 글자의 가운데가 한 줄에 온다 */}
      <span className="flex min-w-0 flex-1 items-start gap-4">
        <Clock
          ms={ms}
          className={cn(
            'w-14 shrink-0 text-base leading-[calc(1.125rem*1.375)] font-bold',
            !current && 'text-ink-muted',
          )}
        />
        <span className="min-w-0 flex-1 text-lg leading-snug">{children}</span>
      </span>
    </button>
  )
}

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
  const listRef = useFollowCurrent<HTMLUListElement>(current?.chapterId)
  const { stopKey, listProps } = useRovingRows(
    chapters.map((c) => c.chapterId),
    current?.chapterId,
  )
  return (
    <section aria-labelledby="chapters-title" className={WRAP}>
      <h2 id="chapters-title" className={LIST_TITLE}>
        장면 목차
        <Dot />
        {chapters.length}개
      </h2>
      {chapters.length === 0 ? (
        <p className="mt-3 text-ink-muted">목차가 없어요.</p>
      ) : (
        // 줄 사이 ↑ ↓ Home End 이동 (useRovingRows). 키는 안쪽 버튼이 받는다
        <ul ref={listRef} className={LIST} {...listProps}>
          {chapters.map((c) => {
            const isCurrent = c.chapterId === current?.chapterId
            return (
              <li key={c.chapterId} data-key={c.chapterId}>
                <TimeRow
                  ms={c.startMs}
                  current={isCurrent}
                  tabStop={c.chapterId === stopKey}
                  onClick={() => onPick(c)}
                  label={`${c.chapterIndex}번, ${c.title}${isCurrent ? ', 지금' : ''}, ${formatPositionSpoken(c.startMs)}부터`}
                >
                  <span className={cn('mr-2', !isCurrent && 'text-ink-muted')}>
                    {c.chapterIndex}.
                  </span>
                  {c.title}
                </TimeRow>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function ScriptPanel({
  lines,
  current,
  onPick,
}: {
  lines: NarrationLine[]
  current: NarrationLine | null
  onPick: (l: NarrationLine) => void
}) {
  const listRef = useFollowCurrent<HTMLUListElement>(current?.lineId)
  const { stopKey, listProps } = useRovingRows(
    lines.map((l) => l.lineId),
    current?.lineId,
  )
  return (
    <section aria-labelledby="script-title" className={WRAP}>
      <h2 id="script-title" className={LIST_TITLE}>
        해설 문장
        <Dot />
        {lines.length}개
      </h2>
      {lines.length === 0 ? (
        <p className="mt-3 text-ink-muted">해설 문장이 없어요.</p>
      ) : (
        // 줄 사이 ↑ ↓ Home End 이동 (useRovingRows). 키는 안쪽 버튼이 받는다
        <ul ref={listRef} className={LIST} {...listProps}>
          {lines.map((l) => {
            const isCurrent = l.lineId === current?.lineId
            return (
              <li key={l.lineId} data-key={l.lineId}>
                <TimeRow
                  ms={l.startMs}
                  current={isCurrent}
                  tabStop={l.lineId === stopKey}
                  onClick={() => onPick(l)}
                  label={`${formatPositionSpoken(l.startMs)}${isCurrent ? ', 지금 문장' : ''}. ${l.text}`}
                >
                  {l.text}
                </TimeRow>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ───────────── 질문 기록(대화) + 장면 후보 ───────────── */

/** 낭독기용 '누가, 언제' (쉼표로 끊는다. 화면용은 shortStamp) */
const stamp = (who: string, ms: number | null) =>
  ms == null ? who : `${who}, ${formatPositionSpoken(ms)}`
const shortStamp = (who: string, ms: number | null) =>
  ms == null ? who : `${who} · ${formatClock(ms)}`

/**
 * 대화 칸의 질문 기록. 내 질문은 오른쪽 남색 말풍선, 답은 왼쪽 연노랑 말풍선, 명령은 가운데 한 줄.
 * 말풍선 모양과 함께 '나'·'AudiSay 답' 이름표를 늘 붙여 색·위치만으로 구별하지 않는다
 */
export function HistoryPanel({
  entries,
  onReplay,
  onGoTo,
  offer = null,
  onAnswerOffer,
  answering = false,
  onStop,
}: {
  entries: HistoryEntry[]
  onReplay: (e: Extract<HistoryEntry, { kind: 'answer' }>) => void
  onGoTo: (ms: number) => void
  /** 답을 받거나 읽는 중이면 마지막 답에 '답 멈추기' 버튼을 단다 (Esc 와 같다) */
  answering?: boolean
  onStop?: () => void
  /** 마지막 항목이 "들으시겠어요?"를 물은 상태면 그 항목에 네/아니요 버튼을 단다 */
  offer?: FutureOffer | null
  onAnswerOffer?: (reply: 'yes' | 'no') => void
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
    <section aria-labelledby="history-title" className={cn(WRAP, 'flex min-h-0 flex-1 flex-col')}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="history-title" className="text-base font-bold text-ink-muted">
          질문 기록
          <Dot />
          {entries.length}개
        </h3>
        {entries.length > 1 && <p className="text-sm text-ink-muted">최근 것이 아래</p>}
      </div>
      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 py-8 text-center">
          <svg
            aria-hidden="true"
            viewBox="0 0 48 48"
            className="mb-2 size-14 text-line"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          >
            <path d="M8 10h32v22H22l-9 7v-7H8z" />
            <path d="M16 19h16M16 25h10" strokeLinecap="round" />
          </svg>
          <p className="text-lg font-bold">아직 질문한 적이 없어요.</p>
        </div>
      ) : (
        <ol ref={listRef} className="mt-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1.5">
          {entries.map((e, i) => {
            // "들으시겠어요?"를 물은 항목: 마지막 항목이고 같은 질문이어야 한다 (답이 다 읽힌 뒤에만)
            const asking =
              !!offer &&
              !!onAnswerOffer &&
              i === entries.length - 1 &&
              e.chatLogId === offer.chatLogId &&
              (e.kind === 'command' || (e.kind === 'answer' && e.done))
            // 답을 읽는 중인데 끝에 "들으시겠어요?"를 물을 답이면, 처음부터 네/아니요 자리로 두고 끝날 때까지 못 누르게 한다
            const reading = e.kind === 'answer' && !e.done && !!e.offering
            const offerWhat = offer?.kind === 'summary' ? '요약' : '뒤 내용'
            const who = e.kind === 'me' ? '나' : e.kind === 'answer' ? 'AudiSay 답' : '명령'
            // 버튼 자리는 답을 받는 동안에도 잡아 둔다 (끝난 뒤 생기면 말풍선 높이가 바뀌어 화면이 밀린다).
            // 읽는 중에는 누를 수 없게(aria-disabled) 두었다가 답이 끝나면 누를 수 있다
            // 답을 받거나 읽는 중인 마지막 답: Esc 를 몰라도 멈출 수 있게 버튼으로도 둔다
            const stop = answering && onStop && i === entries.length - 1 && e.kind === 'answer' && (
              <Button variant="secondary" onClick={onStop} aria-keyshortcuts="Escape">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                답 멈추기
              </Button>
            )
            const actions =
              asking || reading ? (
                // 예/아니요로 묻는 말에는 예/아니요로 답하게 한다. 누르면 '네'·'아니요'라고 적은 것과 같다
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={!asking}
                    onClick={() => onAnswerOffer?.('yes')}
                    aria-label={`네, ${offerWhat} 들을게요`}
                  >
                    네
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!asking}
                    onClick={() => onAnswerOffer?.('no')}
                    aria-label={`아니요, ${offerWhat} 듣지 않을게요`}
                  >
                    아니요
                  </Button>
                  {stop}
                </div>
              ) : (
                e.kind === 'answer' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={!e.done}
                      onClick={() => onReplay(e)}
                      aria-label={`다시 듣기, ${stamp('AudiSay 답', e.videoTimeMs)}`}
                    >
                      다시 듣기
                    </Button>
                    {e.videoTimeMs != null && (
                      <Button
                        variant="secondary"
                        disabled={!e.done}
                        onClick={() => onGoTo(e.videoTimeMs!)}
                        aria-label={`그 장면 보기, ${formatPositionSpoken(e.videoTimeMs)}`}
                      >
                        그 장면 보기
                      </Button>
                    )}
                    {stop}
                  </div>
                )
              )
            return (
              <li
                key={e.key}
                className={cn(
                  'flex flex-col',
                  e.kind === 'me'
                    ? 'items-end'
                    : e.kind === 'command'
                      ? 'items-center'
                      : 'items-start',
                )}
              >
                {e.kind === 'command' ? (
                  <>
                    <p className="inline-flex max-w-full items-center gap-2 rounded-full border-2 border-dashed border-navy bg-paper px-4 py-1.5 font-bold">
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="size-4 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                      <span className="sr-only">{stamp(who, e.videoTimeMs)}. </span>
                      <span>{e.text}</span>
                      {e.videoTimeMs != null && (
                        <span
                          aria-hidden="true"
                          className="font-mono text-sm font-normal text-ink-muted"
                        >
                          {formatClock(e.videoTimeMs)}
                        </span>
                      )}
                    </p>
                    {actions}
                  </>
                ) : (
                  <div
                    className={cn(
                      'px-4 py-3',
                      e.kind === 'me'
                        ? 'max-w-[88%] rounded-2xl rounded-br-md bg-navy text-cream'
                        : 'max-w-[96%] rounded-2xl rounded-bl-md border-2 border-navy bg-yellow-soft',
                    )}
                  >
                    <p
                      className={cn(
                        'text-sm font-bold',
                        e.kind === 'me' ? 'opacity-90' : 'text-navy',
                      )}
                    >
                      <span aria-hidden="true">{shortStamp(who, e.videoTimeMs)}</span>
                      <span className="sr-only">{stamp(who, e.videoTimeMs)}</span>
                    </p>
                    <p className="mt-1 text-lg leading-relaxed">
                      {e.text ||
                        (e.kind === 'answer' && !e.done ? (
                          <span className="text-ink-muted motion-safe:animate-pulse">
                            답을 만드는 중이에요…
                          </span>
                        ) : (
                          ''
                        ))}
                    </p>
                    {actions}
                  </div>
                )}
              </li>
            )
          })}
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
    <section
      aria-labelledby="cands-title"
      className={cn(WRAP, 'rounded-lg border-2 border-navy p-4')}
    >
      {/* 대화 칸(h2 '챗봇과 대화하기') 안이라 질문 기록과 같은 h3 */}
      <h3 id="cands-title" className="text-lg font-bold">
        장면 찾기
        <Dot />
        후보 {candidates.length}곳
      </h3>
      <div className="mt-3 rounded-md border-2 border-navy bg-paper px-4 py-3">
        <p className="font-bold">
          나
          {videoTimeMs != null && (
            <>
              <Dot />
              {formatPositionSpoken(videoTimeMs)}
            </>
          )}
        </p>
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
                {i + 1}
                <Dot />
                {c.title}
                <Dot />
                <Clock ms={c.startMs} />
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
