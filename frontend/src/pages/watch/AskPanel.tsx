import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { useAnnouncer } from '@/features/announcer/context'
import { MIC_MESSAGES } from '@/features/search/micPermission'
import { beepLeadMs } from '@/features/search/speechLead'
import { MAX_RECORD_SEC, VOICE_LABEL, useVoiceRecorder } from '@/features/search/useVoiceRecorder'
import { useShortcutEntry } from '@/features/shortcuts/context'
import { formatClock } from '@/utils/time'

export interface AskPanelProps {
  inputRef: RefObject<HTMLInputElement | null>
  /** 답을 받는 중이면 보내기를 막는다 */
  busy: boolean
  onSubmit: (text: string, mode: 'TEXT' | 'VOICE') => void
  /** 듣기 시작 — 영상을 멈춘다 (원칙 1장) */
  onListenStart: () => void
  /** 듣기를 취소했거나 알아듣지 못했을 때 — 원래 재생 중이었으면 다시 재생한다. 재생했으면 true */
  onListenAbort: () => boolean | void
  /** 지금은 말로 물을 수 없는 이유 (예: 전체 화면이라 질문 칸이 보이지 않음). 있으면 Alt+Shift+Q 가 이 말만 한다 */
  askBlockedReason?: string | null
  /** 보내기·음성 인식 옆에 같은 크기로 둘 버튼 */
  extraAction?: ReactNode
  /**
   * 대화 칸 모양: 제목(위) · 대화 내용(가운데, 이 칸 안에서 스크롤) · 입력칸(아래, 늘 같은 자리).
   * 없으면 예전처럼 제목 아래 입력칸만 그린다
   */
  children?: ReactNode
  className?: string
  /** 입력칸 아래 키 안내를 보일지 (대화 칸이 좁은 크게 보기에서는 끈다) */
  keyHint?: boolean
}

/**
 * '챗봇과 대화하기' (ASK-01, CTL-03). 질문도 명령(장면 이동·설정)도 여기서 한다. 글자로 적거나 말로 한다.
 * Alt+Shift+Q 하나로 입력칸에 포커스를 두고 듣기를 시작한다. 말 대신 글자를 적어도 된다 (원칙 9장).
 */
export function AskPanel({
  inputRef,
  busy,
  onSubmit,
  onListenStart,
  onListenAbort,
  askBlockedReason = null,
  extraAction,
  children,
  className,
  keyHint = true,
}: AskPanelProps) {
  const dock = children !== undefined
  const { announce } = useAnnouncer()
  const [text, setText] = useState('')
  const finishRef = useRef<HTMLButtonElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)

  const voice = useVoiceRecorder({
    onResult: (heard) => {
      // 알아들은 말은 입력칸에 남기지 않고 바로 보낸다 (보낸 말은 대화 칸 '나' 말풍선에 보인다)
      setText('')
      onSubmit(heard, 'VOICE')
    },
    onUnavailable: (reason) => {
      // 권한이 허용된 상태에서는 안내(영상 멈춤)가 마이크보다 먼저 나간다. 마이크를 못 열었으면 영상을 되돌린다
      onListenAbort()
      inputRef.current?.focus()
      announce(`${reason} 질문은 입력칸에 글자로 적어도 돼요.`, { politeness: 'assertive' })
    },
    onAsking: () => announce(MIC_MESSAGES.asking, { politeness: 'assertive' }),
    onRecovered: () => announce(`${MIC_MESSAGES.recovered} Alt+Shift+Q로 다시 물어보세요.`),
  })

  const startVoice = useCallback(async () => {
    if (askBlockedReason) {
      announce(askBlockedReason)
      return
    }
    // 이미 듣는 중·알아듣는 중이면 새로 녹음하지 않는다 (녹음기가 겹치면 마이크가 꺼지지 않는다)
    if (voice.state !== 'idle' && voice.state !== 'error') return
    if (busy) {
      announce('답을 듣는 중이에요. 끝나면 다시 물어보세요.')
      return
    }
    // 입력칸으로 먼저 옮기지 않는다: 바로 뒤에 입력칸이 사라지고 '말 끝내기'로 옮겨 가므로, 먼저 옮기면
    // 낭독기가 "서식 → 입력란 → (사라져서) 문서 → 버튼"을 다 읽는다. 음성을 못 쓰면 onUnavailable 이 입력칸으로 옮긴다
    // 안내 → 낭독기가 읽는 동안 기다림 → '띠' → 녹음 (녹음 중에 낭독기 음성이 겹치거나 녹음되지 않게)
    const intro = "영상을 멈췄어요. '띠' 소리 뒤에 질문하세요."
    await voice.start({
      prepare: () => {
        onListenStart()
        announce(intro)
        return beepLeadMs(intro)
      },
    })
  }, [askBlockedReason, busy, voice, onListenStart, announce])

  useShortcutEntry('ask', () => void startVoice(), { scope: 'user' })

  // 알아들은 뒤 입력칸이 다시 그려지면 바로 입력칸으로 (말 끝내기 버튼이 사라지며 포커스가 본문으로 빠지면
  // 낭독기가 그 자리를 읽어 답 소리와 겹친다. 원칙 9장: 포커스는 입력칸에 남긴다)
  // useLayoutEffect: 포커스가 있던 요소(입력칸·말 끝내기)가 이 렌더에서 사라지면 브라우저가 포커스를 본문으로 내리고
  // 낭독기가 문서 전체("AudiSay - … 영역")를 읽는다. 그리기 전에 같은 작업 안에서 새 자리로 옮겨 한 번만 읽히게 한다
  const prevVoiceState = useRef(voice.state)
  useLayoutEffect(() => {
    const prev = prevVoiceState.current
    prevVoiceState.current = voice.state
    if (voice.state === 'idle' && prev === 'processing') inputRef.current?.focus()
    // 기다림이 없으면 preparing 을 건너뛰고 바로 listening 으로 그려질 수 있다
    if (voice.state === 'preparing' || voice.state === 'listening') finishRef.current?.focus()
    if (voice.state === 'processing') announce('알아듣는 중이에요.')
    if (voice.state === 'error') {
      retryRef.current?.focus()
      announce('말을 알아듣지 못했어요. 다시 말하기 버튼에 있어요.', { politeness: 'assertive' })
    }
  }, [voice.state, announce, inputRef])

  const backToText = useCallback(
    (message: string | ((resumed: boolean) => string)) => {
      voice.reset()
      const resumed = onListenAbort() === true
      requestAnimationFrame(() => inputRef.current?.focus())
      announce(typeof message === 'function' ? message(resumed) : message)
    },
    [voice, onListenAbort, inputRef, announce],
  )

  const cancelVoice = useCallback(() => {
    voice.cancel()
    // 원래 멈춰 있던 영상이면 '이어서 재생해요'라고 하지 않는다
    backToText((resumed) =>
      resumed
        ? '질문을 취소했어요. 영상을 이어서 재생해요.'
        : '질문을 취소했어요. 입력칸에 있어요.',
    )
  }, [voice, backToText])

  const listening = voice.state === 'preparing' || voice.state === 'listening'
  useEffect(() => {
    if (!listening) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelVoice()
      }
    }
    // 캡처: 화면의 다른 Esc(크게 보기 끄기 등)보다 먼저 받고 preventDefault 로 표시해, 같은 Esc 가 두 번 처리되지 않게 한다
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, cancelVoice])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) {
      announce('답을 듣는 중이에요. 끝나면 다시 물어보세요.')
      return
    }
    const q = text.trim()
    if (!q) {
      inputRef.current?.focus()
      announce('질문이나 명령을 적어 주세요.')
      return
    }
    setText('')
    onSubmit(q, 'TEXT')
  }

  const bar = 'flex min-h-touch items-center gap-4 rounded-md border-2 px-5 text-lg'

  return (
    // 바깥 aside('질문')가 이미 랜드마크라 여기는 이름을 붙이지 않는다 (이름이 있으면 region 랜드마크가 되어
    // 포커스가 들어올 때 "보조 정보 랜드마크 → 영역" 두 겹으로 읽힌다). 제목(h2)은 그대로라 H 키 탐색은 된다
    <section
      className={cn(
        dock &&
          'flex flex-col overflow-hidden rounded-2xl border-2 border-line bg-paper shadow-[0_10px_30px_rgba(17,24,39,0.07)]',
        className,
      )}
    >
      <div className={cn(dock && 'border-b-2 border-line px-5 pt-5 pb-4')}>
        <h2 id="ask-title" className="text-2xl font-bold">
          챗봇과 대화하기
        </h2>
      </div>
      {dock && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">{children}</div>
      )}
      <div className={cn(dock && 'border-t-2 border-line px-5 pt-4 pb-5')}>
        {voice.state === 'idle' && (
          <form onSubmit={submit} className={cn(!dock && 'mt-4')}>
            <input
              ref={inputRef}
              type="text"
              aria-labelledby="ask-title"
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
              // 답을 듣는 동안에도 막지 않는다 (보내기는 submit 이 막는다).
              // disabled 면 포커스가 본문으로 빠지고, readOnly 를 켜고 끄면 낭독기가 '읽기 전용' 상태 변화를 읽어 답 소리와 겹친다
              className="min-h-touch w-full rounded-md border-2 border-navy bg-paper px-5 text-lg"
            />
            {/* 버튼은 같은 폭으로 나란히 (즐겨찾기 같은 버튼을 더 받으면 3칸) */}
            <div className={cn('mt-4 grid gap-2', extraAction ? 'grid-cols-3' : 'grid-cols-2')}>
              <Button type="submit" size="panel" disabled={busy}>
                보내기
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="panel"
                aria-keyshortcuts="Alt+Shift+Q"
                onClick={() => void startVoice()}
                disabled={busy}
              >
                음성 인식
              </Button>
              {extraAction}
            </div>
            {/* 키 안내. 단축키는 버튼 속성(aria-keyshortcuts)에도 있지만 눈으로도 보이게 */}
            {dock && keyHint && (
              <p className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xl text-ink-muted">
                <span className="whitespace-nowrap">
                  <kbd className="kbd border-line px-1.5 text-lg text-ink">Enter</kbd>{' '}
                  보내기
                </span>
                <span className="whitespace-nowrap">
                  <kbd className="kbd border-line px-1.5 text-lg text-ink">
                    Alt+Shift+Q
                  </kbd>{' '}
                  말로 묻기
                </span>
                <span className="whitespace-nowrap">
                  <kbd className="kbd border-line px-1.5 text-lg text-ink">Esc</kbd> 답
                  멈추기
                </span>
              </p>
            )}
          </form>
        )}

        {voice.state !== 'idle' && voice.state !== 'error' && (
          <div className={cn(!dock && 'mt-4')}>
            {/* 낭독은 Announcer 가 맡으므로 role 을 두지 않는다 (두 번 읽힘 방지) */}
            <div className={cn(bar, 'border-navy bg-yellow-soft')}>
              <span aria-hidden="true" className="text-danger">
                ●
              </span>
              <span className="font-bold">{VOICE_LABEL[voice.state]}</span>
              {/* 남은 시간은 매초 읽지 않는다 (원칙 9장) */}
              <span aria-hidden="true" className="ml-auto font-mono tabular-nums">
                {formatClock(voice.elapsed * 1000)} / {formatClock(MAX_RECORD_SEC * 1000)}
              </span>
            </div>
            {/* 버튼 크기·폭은 평소(보내기·음성 인식)와 같게: 상태가 바뀌어도 칸 높이가 출렁이지 않는다 */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              {/* 알아듣는 중에는 aria-disabled 를 주지 않는다 (SearchBar 와 같은 이유: 포커스가 있는 버튼의
                  상태가 바뀌면 낭독기가 "사용 불가"를 읽는다). 눈으로만 흐리게 한다 */}
              <Button
                ref={finishRef}
                variant="accent"
                size="panel"
                disabled={voice.state === 'preparing'}
                className={cn(voice.state === 'processing' && 'cursor-progress opacity-60')}
                onClick={voice.stop}
              >
                말 끝내기
              </Button>
              <Button variant="secondary" size="panel" onClick={cancelVoice}>
                취소
              </Button>
            </div>
            {dock && keyHint && (
              <p className="mt-3 text-center text-base text-ink-muted">
                1분이 지나면 자동으로 끝나요.
              </p>
            )}
          </div>
        )}

        {voice.state === 'error' && (
          <div className={cn(!dock && 'mt-4')}>
            <div className={cn(bar, 'border-danger bg-danger-soft text-danger')}>
              <span aria-hidden="true">●</span>
              <span className="font-bold">알아듣지 못했어요</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                ref={retryRef}
                variant="accent"
                size="panel"
                onClick={() => void startVoice()}
              >
                다시 말하기
              </Button>
              <Button
                variant="secondary"
                size="panel"
                onClick={() => backToText('입력칸에 있어요. 글자로 적어 주세요.')}
              >
                글자로 묻기
              </Button>
            </div>
            {dock && keyHint && (
              <p className="mt-3 text-center text-base text-ink-muted">
                다시 말하거나 글자로 물어보세요.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
