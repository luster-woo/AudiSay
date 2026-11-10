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
import { MAX_CANDIDATES, type FutureOffer } from './useAsk'

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
const WRAP = '[overflow-wrap:anywhere]'

/* ───────────── 목차·해설: 같은 줄 모양 ───────────── */

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
  dubIds,
  current,
  onPick,
}: {
  lines: NarrationLine[]
  /** 외국어 대사를 한국어로 읽어 주는 문장 id: 해설이 아니라 '대사'로 보인다 */
  dubIds?: ReadonlySet<number>
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
            const isDub = dubIds?.has(l.lineId) ?? false
            return (
              <li key={l.lineId} data-key={l.lineId}>
                <TimeRow
                  ms={l.startMs}
                  current={isCurrent}
                  tabStop={l.lineId === stopKey}
                  onClick={() => onPick(l)}
                  label={`${formatPositionSpoken(l.startMs)}${isCurrent ? ', 지금 문장' : ''}${isDub ? ', 대사 번역' : ''}. ${l.text}`}
                >
                  {isDub && (
                    // 해설 문장과 한눈에 갈리게: 굵은 테두리·넉넉한 안쪽 여백·굵은 글자 (글은 aria-label 이 읽는다).
                    // 테두리는 글자색을 따른다: 고대비에서 지금 줄(노란 바탕)이 되어도 테두리가 바탕에 묻히지 않게
                    <span className="mr-3 inline-block rounded-md border-2 border-current px-2.5 py-0.5 align-[0.0625rem] text-base leading-tight font-extrabold">
                      대사
                    </span>
                  )}
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
 * 말풍선 하나. 내 말은 오른쪽 남색, 답은 왼쪽 연노랑(대화 칸 폭을 다 쓴다 — 글 길이에 따라 폭이 바뀌면
 * 아래 버튼이 한 줄이 됐다 두 줄이 됐다 한다). 모양과 함께 '나'·'AudiSay 답' 이름표를 늘 붙여 색·위치만으로 구별하지 않는다
 */
function Bubble({
  who,
  videoTimeMs,
  children,
  actions,
}: {
  who: 'me' | 'answer'
  videoTimeMs: number | null
  children: ReactNode
  actions?: ReactNode
}) {
  const name = who === 'me' ? '나' : 'AudiSay 답'
  return (
    <div
      className={cn(
        'px-4 py-3',
        who === 'me'
          ? 'max-w-[88%] rounded-2xl rounded-br-md bg-navy text-cream'
          : 'w-full rounded-2xl rounded-bl-md border-2 border-navy bg-yellow-soft',
      )}
    >
      <p className={cn('text-sm font-bold', who === 'me' ? 'opacity-90' : 'text-navy')}>
        <span aria-hidden="true">{shortStamp(name, videoTimeMs)}</span>
        <span className="sr-only">{stamp(name, videoTimeMs)}</span>
      </p>
      <div className="mt-1 text-lg leading-relaxed">{children}</div>
      {actions}
    </div>
  )
}

/**
 * 답 아래 버튼 줄: 늘 같은 폭의 두 칸으로 한 줄 (글자 길이·버튼 수와 상관없이 줄바꿈이 생기지 않게).
 * 버튼이 하나면 왼쪽 칸에만 둔다 (두 개일 때와 버튼 크기가 같다)
 */
function ActionRow({ children, className }: { children: ReactNode[]; className?: string }) {
  return (
    <div className={cn('mt-3 grid grid-cols-2 gap-2', className)}>{children.filter(Boolean)}</div>
  )
}
const ACTION = 'w-full px-2! whitespace-nowrap'

/**
 * 대화 칸의 질문 기록. 질문이든 명령(이동·설정)이든 모두 같은 모양:
 * '나' 말풍선 + 'AudiSay 답' 말풍선, 답 아래에는 [다시 듣기][그 장면 보기] 두 칸.
 * '다시 듣기'는 모든 답에, '그 장면 보기'는 장면 이동(시각·장면으로 가기, 후보 고르기)의 답에만 붙는다.
 * 답을 받거나 읽는 동안에는 '다시 듣기' 자리가 '답 멈추기'가 된다 (버튼 수가 그대로라 말풍선 모양이 바뀌지 않는다).
 * "들으시겠어요?"를 묻는 답에는 그 위에 [네][아니요] 줄이 더 붙는다
 */
export function HistoryPanel({
  entries,
  onReplay,
  onGoTo,
  offer = null,
  onAnswerOffer,
  answering = false,
  replayingKey = null,
  onStop,
  tail,
}: {
  entries: HistoryEntry[]
  onReplay: (e: Extract<HistoryEntry, { kind: 'answer' }>) => void
  onGoTo: (ms: number) => void
  /** 답을 받거나 읽는 중이면 마지막 답의 '다시 듣기' 자리에 '답 멈추기' 버튼을 둔다 (Esc 와 같다) */
  answering?: boolean
  /** '다시 듣기'로 읽는 중인 답의 key. 그 답의 '다시 듣기' 자리에 '멈추기'를 둔다 (Esc 와 같다) */
  replayingKey?: string | null
  onStop?: () => void
  /** 마지막 항목이 "들으시겠어요?"를 물은 상태면 그 항목에 네/아니요 버튼을 단다 */
  offer?: FutureOffer | null
  onAnswerOffer?: (reply: 'yes' | 'no') => void
  /** 기록 맨 끝에 이어 붙일 항목 (장면 후보를 고르는 중인 질문). <li> 들이어야 한다 */
  tail?: ReactNode
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const last = entries[entries.length - 1]
  const lastKey = last?.key
  const lastText = last?.text
  const hasTail = tail != null && tail !== false
  // '질문 기록 · N개'는 말풍선 수가 아니라 질문('나' 말풍선) 수다
  const questionCount = entries.filter((e) => e.kind === 'me').length
  // 새 항목이 생기거나 답이 이어서 적히면 아래로 따라간다
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [lastKey, lastText, hasTail])

  return (
    <section aria-labelledby="history-title" className={cn(WRAP, 'flex min-h-0 flex-1 flex-col')}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="history-title" className="text-base font-bold text-ink-muted">
          질문 기록
          <Dot />
          {questionCount}개
        </h3>
        {entries.length > 1 && <p className="text-sm text-ink-muted">최근 것이 아래</p>}
      </div>
      {entries.length === 0 && !hasTail ? (
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
            if (e.kind === 'me') {
              return (
                <li key={e.key} className="flex flex-col items-end">
                  <Bubble who="me" videoTimeMs={e.videoTimeMs}>
                    {e.text}
                  </Bubble>
                </li>
              )
            }
            const isLast = i === entries.length - 1
            // "들으시겠어요?"를 물은 답: 마지막 항목이고 같은 질문이어야 한다 (답이 다 읽힌 뒤에만 누를 수 있다)
            const asking =
              !!offer && !!onAnswerOffer && isLast && e.chatLogId === offer.chatLogId && e.done
            // 답을 읽는 중인데 끝에 "들으시겠어요?"를 물을 답이면, 처음부터 네/아니요 자리를 잡아 둔다
            const reading = !e.done && !!e.offering
            const offerWhat = offer?.kind === 'summary' ? '요약' : '뒤 내용'
            const replaying = !!onStop && replayingKey === e.key
            const stopping = (answering && !!onStop && isLast && !e.done) || replaying
            // '그 장면 보기': 장면 이동의 답에만, 옮긴 시각으로. 질문·설정·기능 실행 등은 '다시 듣기'만
            const goTo = e.goToMs ?? null
            return (
              <li key={e.key} className="flex flex-col items-start">
                <Bubble
                  who="answer"
                  videoTimeMs={e.videoTimeMs}
                  actions={
                    <>
                      {(asking || reading) && (
                        // 예/아니요로 묻는 말에는 예/아니요로 답하게 한다. 누르면 '네'·'아니요'라고 적은 것과 같다
                        <ActionRow>
                          {[
                            <Button
                              key="yes"
                              variant="secondary"
                              disabled={!asking}
                              onClick={() => onAnswerOffer?.('yes')}
                              aria-label={`네, ${offerWhat} 들을게요`}
                              className={ACTION}
                            >
                              네
                            </Button>,
                            <Button
                              key="no"
                              variant="secondary"
                              disabled={!asking}
                              onClick={() => onAnswerOffer?.('no')}
                              aria-label={`아니요, ${offerWhat} 듣지 않을게요`}
                              className={ACTION}
                            >
                              아니요
                            </Button>,
                          ]}
                        </ActionRow>
                      )}
                      <ActionRow>
                        {[
                          stopping ? (
                            // 답을 받거나 읽는 중: Esc 를 몰라도 멈출 수 있게 '다시 듣기' 자리에 둔다
                            <Button
                              key="replay"
                              onClick={onStop}
                              aria-keyshortcuts="Escape"
                              className={ACTION}
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="size-4 shrink-0"
                                fill="currentColor"
                              >
                                <rect x="6" y="6" width="12" height="12" rx="2" />
                              </svg>
                              {replaying ? '멈추기' : '답 멈추기'}
                            </Button>
                          ) : (
                            <Button
                              key="replay"
                              variant="secondary"
                              disabled={!e.done}
                              onClick={() => onReplay(e)}
                              aria-label={`다시 듣기, ${stamp('AudiSay 답', e.videoTimeMs)}`}
                              className={ACTION}
                            >
                              다시 듣기
                            </Button>
                          ),
                          goTo != null && (
                            <Button
                              key="goto"
                              variant="secondary"
                              disabled={!e.done}
                              onClick={() => onGoTo(goTo)}
                              aria-label={`그 장면 보기, ${formatPositionSpoken(goTo)}`}
                              className={ACTION}
                            >
                              그 장면 보기
                            </Button>
                          ),
                        ]}
                      </ActionRow>
                    </>
                  }
                >
                  {e.text ||
                    (!e.done ? (
                      <span className="text-ink-muted motion-safe:animate-pulse">
                        답을 만드는 중이에요…
                      </span>
                    ) : (
                      ''
                    ))}
                </Bubble>
              </li>
            )
          })}
          {tail}
        </ol>
      )}
    </section>
  )
}

/**
 * 말로 장면 이동이 애매할 때 후보를 고르는 화면 (NAV-05, 원칙 5·9장).
 * 질문 기록 끝에 다른 질문과 같은 모양('나' + 'AudiSay 답')으로 붙고, 답 말풍선 안에서 후보를 고른다.
 * 라디오 그룹: ↑ ↓ 로 고르고 Enter 로 이동. '둘 다 아니에요' 는 따로 버튼.
 * HistoryPanel 의 tail 로 넣는다 (<li> 두 개)
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
  // 후보는 3개까지만 (useAsk·서버도 자르지만 여기서도 지킨다)
  const shown = candidates.slice(0, MAX_CANDIDATES)
  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  const onKey = (e: KeyboardEvent, i: number) => {
    const n = shown.length
    let next: number | null = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % n
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + n) % n
    if (next === null) return
    e.preventDefault()
    setChosen(next)
    refs.current[next]?.focus()
  }

  return (
    <>
      <li className="flex flex-col items-end">
        <Bubble who="me" videoTimeMs={videoTimeMs}>
          {utterance}
        </Bubble>
      </li>
      <li className="flex flex-col items-start">
        <Bubble who="answer" videoTimeMs={videoTimeMs}>
          {/* 글은 눈으로 보는 것. 낭독기는 첫 후보로 포커스가 가며 묶음 이름(아래 aria-label)을 한 번 읽는다 */}
          <p aria-hidden="true" className="font-bold">
            비슷한 장면이 {shown.length}곳 있어요. 번호를 고르세요.
          </p>
          <div
            role="radiogroup"
            aria-label={`비슷한 장면 ${shown.length}곳. 위·아래 화살표로 고르고 Enter로 이동해요. 번호를 말해도 돼요`}
            className="mt-3 space-y-2"
          >
            {shown.map((c, i) => {
              const checked = i === chosen
              return (
                <button
                  // 후보는 장면 단위라 chapterId 가 겹칠 수 있다. 시각까지 붙여 구분한다
                  key={`${c.chapterId}-${c.startMs}`}
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
                    'w-full rounded-md border-2 border-navy px-4 py-3 text-left text-base',
                    checked ? 'bg-yellow' : 'bg-paper',
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
                  {c.summary && <span className="mt-1 block">{c.summary}</span>}
                </button>
              )
            })}
          </div>
          <ActionRow>
            {[
              <Button
                key="none"
                variant="secondary"
                onClick={onNone}
                className={cn(ACTION, 'col-span-2')}
              >
                {shown.length === 2 ? '둘 다 아니에요' : '모두 아니에요'}, 다시 말할게요
              </Button>,
            ]}
          </ActionRow>
          <p aria-hidden="true" className="mt-2 text-base text-ink-muted">
            위·아래 화살표로 고르고 Enter로 이동해요.
          </p>
        </Bubble>
      </li>
    </>
  )
}
