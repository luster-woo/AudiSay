import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { useAnnouncer } from '@/features/announcer/context'
import { useShortcut } from '@/features/shortcuts/context'
import { formatClock } from '@/utils/time'
import { isYoutubeUrl } from '@/utils/youtube'
import { MIC_MESSAGES } from './micPermission'
import { MAX_RECORD_SEC, useVoiceRecorder } from './useVoiceRecorder'

/** 듣는 중 파형. 장식이라 숨기고, 움직임 줄이기 설정이면 멈춘다 */
const WAVE = [6, 12, 20, 10, 26, 14, 8, 22, 30, 16, 10, 24, 12, 28, 18, 8, 20, 14, 26, 10, 16, 22]

/**
 * 홈·검색 결과 위쪽 검색 줄 (원칙 7장: 이름은 코드에만, role="search").
 * 글자로 찾기 + 음성으로 찾기(Alt+Shift+Q). 음성은 듣는 중 → 알아듣는 중 → (실패 시) 다시 말하기.
 */
export function SearchBar({
  defaultValue = '',
  inputRef,
}: {
  defaultValue?: string
  /** 페이지가 처음 포커스를 줄 수 있게 입력칸 ref 를 넘겨받는다 */
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  const navigate = useNavigate()
  const { announce } = useAnnouncer()
  const [text, setText] = useState(defaultValue)
  const localInputRef = useRef<HTMLInputElement | null>(null)
  const ownInputRef = inputRef ?? localInputRef
  const finishRef = useRef<HTMLButtonElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)

  const search = useCallback(
    (raw: string) => {
      const value = raw.trim()
      if (!value) {
        ownInputRef.current?.focus()
        announce('검색어나 유튜브 주소를 입력해 주세요.')
        return
      }
      if (isYoutubeUrl(value)) navigate(`/search/youtube?url=${encodeURIComponent(value)}`)
      else navigate(`/search?q=${encodeURIComponent(value)}`)
    },
    [announce, navigate, ownInputRef],
  )

  const voice = useVoiceRecorder({
    onResult: (heard) => {
      setText(heard)
      search(heard)
    },
    onUnavailable: (reason) => {
      ownInputRef.current?.focus()
      announce(`${reason} 글자로 찾기는 그대로 쓸 수 있어요. 검색 칸에 있어요.`, {
        politeness: 'assertive',
      })
    },
    onAsking: () => announce(MIC_MESSAGES.asking, { politeness: 'assertive' }),
    onRecovered: () => announce(`${MIC_MESSAGES.recovered} 음성으로 찾기를 다시 눌러 주세요.`),
  })

  const startVoice = useCallback(async () => {
    if (await voice.start()) {
      announce("'띠' 소리 뒤에 말씀하세요. 듣고 있어요. 다 말했으면 Space를 누르세요.")
    }
  }, [voice, announce])

  useShortcut('Alt+Shift+Q', () => void startVoice(), {
    description: '음성으로 찾기',
    scope: 'user',
  })

  // 상태가 바뀌면 다음에 누를 버튼으로 포커스를 옮긴다
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
      requestAnimationFrame(() => ownInputRef.current?.focus())
      announce(message)
    },
    [voice, announce, ownInputRef],
  )

  const cancelVoice = useCallback(() => {
    voice.cancel()
    backToText('음성으로 찾기를 취소했어요. 검색 칸에 있어요.')
  }, [voice, backToText])

  // 듣는 중 Esc 는 취소
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

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    search(text)
  }

  const box = 'flex min-h-touch min-w-0 flex-1 items-center gap-4 rounded-md border-2 px-5 text-2xl'

  return (
    <div role="search" aria-label="영상 찾기">
      <p aria-hidden="true" className="text-2xl text-ink">
        검색어나 유튜브 주소 입력하기
      </p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-stretch gap-4">
        {voice.state === 'idle' && (
          <>
            <input
              ref={ownInputRef}
              type="search"
              aria-label="검색어나 유튜브 주소로 찾기"
              enterKeyHint="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-touch min-w-0 flex-1 rounded-md border-2 border-navy bg-paper px-5 text-2xl"
            />
            <Button type="submit" size="xl">
              찾기
            </Button>
            <Button
              variant="secondary"
              size="xl"
              aria-keyshortcuts="Alt+Shift+Q"
              onClick={() => void startVoice()}
            >
              음성으로 찾기
            </Button>
          </>
        )}

        {(voice.state === 'listening' || voice.state === 'processing') && (
          <>
            <div className={cn(box, 'border-navy bg-yellow-soft')}>
              <span aria-hidden="true" className="text-danger">
                ●
              </span>
              <span className="font-bold">
                {voice.state === 'listening' ? '듣고 있어요' : '알아듣는 중이에요'}
              </span>
              {voice.state === 'listening' && (
                <span aria-hidden="true" className="flex h-8 items-center gap-0.5">
                  {WAVE.map((h, i) => (
                    <span
                      key={i}
                      className="w-0.5 bg-ink motion-safe:animate-pulse"
                      style={{ height: `${h}px`, animationDelay: `${(i % 5) * 120}ms` }}
                    />
                  ))}
                </span>
              )}
              {/* 남은 시간은 매초 읽지 않는다 (원칙 9장) */}
              <span aria-hidden="true" className="ml-auto tabular-nums">
                {formatClock(voice.elapsed * 1000)} / {formatClock(MAX_RECORD_SEC * 1000)}
              </span>
            </div>
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
          </>
        )}

        {voice.state === 'error' && (
          <>
            <div className={cn(box, 'border-danger bg-danger-soft text-danger')}>
              <span aria-hidden="true">●</span>
              <span className="font-bold">알아듣지 못했어요</span>
              <span aria-hidden="true" className="ml-auto tabular-nums">
                {formatClock(voice.elapsed * 1000)}
              </span>
            </div>
            <Button ref={retryRef} variant="accent" size="xl" onClick={() => void startVoice()}>
              다시 말하기
            </Button>
            <Button
              variant="secondary"
              size="xl"
              onClick={() => backToText('검색 칸에 있어요. 글자로 적어 주세요.')}
            >
              글자로 찾기
            </Button>
          </>
        )}
      </form>
    </div>
  )
}
