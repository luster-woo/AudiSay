import {
  useCallback,
  useEffect,
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
import { MAX_RECORD_SEC, useVoiceRecorder } from '@/features/search/useVoiceRecorder'
import { useShortcut } from '@/features/shortcuts/context'
import { formatClock } from '@/utils/time'

export interface AskPanelProps {
  inputRef: RefObject<HTMLInputElement | null>
  /** 답을 받는 중이면 보내기를 막는다 */
  busy: boolean
  onSubmit: (text: string, mode: 'TEXT' | 'VOICE') => void
  /** 듣기 시작 — 영상을 멈춘다 (원칙 1장) */
  onListenStart: () => void
  /** 듣기를 취소했거나 알아듣지 못했을 때 — 영상을 다시 재생한다 */
  onListenAbort: () => void
  /** 보내기·음성 인식 옆에 같은 크기로 둘 버튼 (즐겨찾기) */
  extraAction?: ReactNode
}

/**
 * '질문하거나 명령하기' (ASK-01, CTL-03). 글자로 적거나 말로 한다.
 * Alt+Shift+Q 하나로 입력칸에 포커스를 두고 듣기를 시작한다. 말 대신 글자를 적어도 된다 (원칙 9장).
 */
export function AskPanel({
  inputRef,
  busy,
  onSubmit,
  onListenStart,
  onListenAbort,
  extraAction,
}: AskPanelProps) {
  const { announce } = useAnnouncer()
  const [text, setText] = useState('')
  const finishRef = useRef<HTMLButtonElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)

  const voice = useVoiceRecorder({
    onResult: (heard) => {
      setText(heard)
      onSubmit(heard, 'VOICE')
    },
    onUnavailable: (reason) => {
      inputRef.current?.focus()
      announce(`${reason} 질문은 입력칸에 글자로 적어도 돼요.`, { politeness: 'assertive' })
    },
    onAsking: () => announce(MIC_MESSAGES.asking, { politeness: 'assertive' }),
    onRecovered: () => announce(`${MIC_MESSAGES.recovered} Alt+Shift+Q로 다시 물어보세요.`),
  })

  const startVoice = useCallback(async () => {
    if (busy) {
      announce('답을 듣는 중이에요. 끝나면 다시 물어보세요.')
      return
    }
    inputRef.current?.focus()
    if (await voice.start()) {
      onListenStart()
      announce("영상을 멈췄어요. '띠' 소리 뒤에 질문하세요. 다 말했으면 '말 끝내기'를 누르세요.")
    }
  }, [busy, voice, inputRef, onListenStart, announce])

  useShortcut('Alt+Shift+Q', () => void startVoice(), {
    description: '질문하기 (말로, 또는 글자로)',
    scope: 'user',
    allowInInput: true,
  })

  useEffect(() => {
    if (voice.state === 'listening') finishRef.current?.focus()
    if (voice.state === 'processing') announce('알아듣는 중이에요.')
    if (voice.state === 'error') {
      retryRef.current?.focus()
      announce('말을 알아듣지 못했어요. 다시 말하기 버튼에 있어요.', { politeness: 'assertive' })
    }
  }, [voice.state, announce])

  const backToText = useCallback(
    (message: string) => {
      voice.reset()
      onListenAbort()
      requestAnimationFrame(() => inputRef.current?.focus())
      announce(message)
    },
    [voice, onListenAbort, inputRef, announce],
  )

  const cancelVoice = useCallback(() => {
    voice.cancel()
    backToText('질문을 취소했어요. 영상을 이어서 재생해요.')
  }, [voice, backToText])

  const listening = voice.state === 'listening'
  useEffect(() => {
    if (!listening) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelVoice()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listening, cancelVoice])

  const submit = (e: FormEvent) => {
    e.preventDefault()
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
    <section aria-labelledby="ask-title">
      <h2 id="ask-title" className="text-2xl font-bold">
        질문하거나 명령하기
      </h2>
      {voice.state === 'idle' && (
        <form onSubmit={submit} className="mt-4">
          <input
            ref={inputRef}
            type="text"
            aria-labelledby="ask-title"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            className="min-h-touch w-full rounded-md border-2 border-navy bg-paper px-5 text-lg"
          />
          {/* 아래 목차·대본·질문 기록 탭과 같은 3칸·같은 크기로 맞춘다 */}
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
        </form>
      )}

      {(voice.state === 'listening' || voice.state === 'processing') && (
        <div className="mt-4">
          <div role="status" className={cn(bar, 'border-navy bg-yellow-soft')}>
            <span aria-hidden="true" className="text-danger">
              ●
            </span>
            <span className="font-bold">
              {voice.state === 'listening' ? '듣고 있어요' : '알아듣는 중이에요'}
            </span>
            {/* 남은 시간은 매초 읽지 않는다 (원칙 9장) */}
            <span aria-hidden="true" className="ml-auto font-mono tabular-nums">
              {formatClock(voice.elapsed * 1000)} / {formatClock(MAX_RECORD_SEC * 1000)}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              ref={finishRef}
              variant="accent"
              size="xl"
              disabled={voice.state === 'processing'}
              onClick={voice.stop}
            >
              말 끝내기
            </Button>
            <Button variant="secondary" size="xl" onClick={cancelVoice}>
              취소
            </Button>
          </div>
          <p className="mt-4 text-ink-muted">
            1분이 지나면 자동으로 끝나요. 말을 마치면 질문으로 보내고, 답이 끝나면 영상을 다시
            재생해요.
          </p>
        </div>
      )}

      {voice.state === 'error' && (
        <div className="mt-4">
          <div role="alert" className={cn(bar, 'border-danger bg-danger-soft text-danger')}>
            <span aria-hidden="true">●</span>
            <span className="font-bold">알아듣지 못했어요</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button ref={retryRef} variant="accent" size="xl" onClick={() => void startVoice()}>
              다시 말하기
            </Button>
            <Button
              variant="secondary"
              size="xl"
              onClick={() => backToText('입력칸에 있어요. 글자로 적어 주세요.')}
            >
              글자로 묻기
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
