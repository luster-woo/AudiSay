import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { chatApi } from '@/api/chat'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { useAnnouncer } from '@/features/announcer/context'
import { useSettings } from '@/features/settings/context'
import { useShortcutEntry } from '@/features/shortcuts/context'
import { coerceSetting, settingSpoken } from '@/pages/watch/useAsk'
import { withRo } from '@/utils/korean'
import { formatClock } from '@/utils/time'
import { isYoutubeUrl } from '@/utils/youtube'
import { MIC_MESSAGES } from './micPermission'
import { MAX_RECORD_SEC, useVoiceRecorder } from './useVoiceRecorder'

/** 듣는 중 파형. 장식이라 숨기고, 움직임 줄이기 설정이면 멈춘다 */
/** 음성 검색 부가 기능 안내는 처음 3번만 읽는다. 저장소를 못 쓰면(사생활 보호 창 등) 매번 읽는다 */
const VOICE_TIP_KEY = 'audisay.voiceSearchTipCount'
const VOICE_TIP_TIMES = 3
function takeVoiceTip() {
  try {
    const n = Number(localStorage.getItem(VOICE_TIP_KEY) ?? 0)
    if (n >= VOICE_TIP_TIMES) return false
    localStorage.setItem(VOICE_TIP_KEY, String(n + 1))
    return true
  } catch {
    return true
  }
}

const WAVE = [6, 12, 20, 10, 26, 14, 8, 22, 30, 16, 10, 24, 12, 28, 18, 8, 20, 14, 26, 10, 16, 22]

/**
 * 홈·검색 결과 위쪽 검색 줄 (원칙 7장: 이름은 코드에만, role="search").
 * 글자로 검색 + 음성 검색(Alt+Shift+Q). 음성은 듣는 중 → 알아듣는 중 → (실패 시) 다시 말하기.
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
  const voiceHintId = useId()
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

  const { update: updateSettings } = useSettings()
  /**
   * 음성 검색은 받아쓴 말을 챗봇으로 먼저 나눈다 (글자 검색은 LLM 비용·대기 없이 바로 검색).
   * "고양이 영상 찾아 줘" → '고양이'로 검색, "말 빠르게" → 설정 변경, "도움말" → 도움말.
   * 그 밖이거나 실패(한도 초과 포함)하면 받아쓴 말 그대로 검색한다
   */
  const onHeard = useCallback(
    async (heard: string) => {
      setText(heard)
      try {
        const res = await chatApi.send({
          videoId: null,
          descriptionId: null,
          videoTimeMs: null,
          utterance: heard,
          inputMode: 'VOICE',
        })
        if (res.intent === 'SEARCH_VIDEO' && res.result.query) {
          setText(res.result.query)
          search(res.result.query)
          return
        }
        if (res.intent === 'SETTING') {
          const { settingKey, settingValue, message } = res.result
          const patch = coerceSetting(settingKey, settingValue)
          if (patch) {
            setText('')
            await updateSettings(patch)
            ownInputRef.current?.focus()
            announce(message || `${withRo(settingSpoken(settingKey, settingValue))} 바꿨어요.`)
            return
          }
        }
        if (res.intent === 'ACTION' && res.result.actionCode === 'HELP') {
          navigate('/help')
          return
        }
        if (res.intent === 'ACTION' && res.result.actionCode === 'REPLAY_TUTORIAL') {
          navigate('/tutorial/1')
          return
        }
      } catch {
        // 분류가 안 되면 받아쓴 말로 검색하면 된다
      }
      search(heard)
    },
    [search, updateSettings, announce, navigate, ownInputRef],
  )

  const voice = useVoiceRecorder({
    onResult: (heard) => void onHeard(heard),
    onUnavailable: (reason) => {
      ownInputRef.current?.focus()
      announce(`${reason} 글자로 찾기는 그대로 쓸 수 있어요. 검색 칸에 있어요.`, {
        politeness: 'assertive',
      })
    },
    onAsking: () => announce(MIC_MESSAGES.asking, { politeness: 'assertive' }),
    onRecovered: () => announce(`${MIC_MESSAGES.recovered} 음성 검색을 다시 눌러 주세요.`),
  })

  const startVoice = useCallback(async () => {
    if (await voice.start()) {
      // 처음 몇 번만 부가 기능을 함께 알린다 (매번 길게 읽지 않게)
      const tip = takeVoiceTip() ? ' 영상 이름이나 "말 빠르게" 같은 설정을 말해도 돼요.' : ''
      announce(`'띠' 소리 뒤에 말씀하세요.${tip} 듣고 있어요. 다 말했으면 Space를 누르세요.`)
    }
  }, [voice, announce])

  useShortcutEntry('voiceSearch', () => void startVoice(), { scope: 'user' })

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
    backToText('음성 검색을 취소했어요. 검색 칸에 있어요.')
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
    // 검색 랜드마크는 form 하나만 (div role=search + form 이면 '검색 랜드마크'·'서식 랜드마크'가 두 번 읽힌다)
    <div>
      {/* 아래 검색 칸의 안내라 제목보다 검색 칸에 가깝게 둔다 */}
      <p aria-hidden="true" className="mt-3 text-2xl text-ink">
        검색어나 유튜브 주소 입력하기
      </p>
      <form
        role="search"
        aria-label="영상 찾기"
        onSubmit={onSubmit}
        className="mt-2 flex flex-wrap items-stretch gap-4"
      >
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
              검색
            </Button>
            <Button
              variant="secondary"
              size="xl"
              aria-keyshortcuts="Alt+Shift+Q"
              aria-describedby={voiceHintId}
              onClick={() => void startVoice()}
            >
              음성 검색
            </Button>
            {/* 음성으로만 되는 부가 기능 안내. 버튼에 이어 읽힌다 (예시는 둘만: 버튼에 올 때마다 길게 읽히지 않게) */}
            <p id={voiceHintId} className="basis-full text-lg text-ink">
              음성으로는 "고양이 영상 찾아 줘", "말 빠르게"처럼 말해도 돼요.
            </p>
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
