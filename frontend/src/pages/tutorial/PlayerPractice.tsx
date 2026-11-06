import { useEffect, useEffectEvent, useState, type KeyboardEvent } from 'react'
import { useAnnouncer } from '@/features/announcer/context'
import { useAudio } from '@/features/audio/useAudio'
import { useShortcutEntry } from '@/features/shortcuts/context'
import { Button } from '@/components/ui/Button'
import { StatusLine } from '@/components/ui/StatusLine'
import { withRo } from '@/utils/korean'
import { formatClock, formatDurationSpoken } from '@/utils/time'

const LENGTH = 10
const STEP = 5
/** 연습 영상 장면: 해설(자동으로 읽음)과 장면 설명(Alt+Shift+D) */
const SCENES = [
  {
    at: 0,
    line: '밝은 부엌이에요. 도마 위에 대파와 양파가 있어요.',
    detail: '밝은 부엌. 나무 도마 위에 대파 두 대와 양파 하나가 놓여 있어요.',
  },
  {
    at: 4,
    line: '손이 대파를 송송 썰어요.',
    detail: '왼손으로 대파를 잡고, 오른손에 쥔 칼로 잘게 썰고 있어요.',
  },
  {
    at: 7,
    line: '냄비에서 김이 올라와요.',
    detail: '가스레인지 위 작은 냄비에서 물이 끓고 김이 올라와요.',
  },
]

const sceneAt = (t: number) => [...SCENES].reverse().find((s) => s.at <= t)!

/**
 * 3단계 연습: 10초짜리 가짜 플레이어.
 * 해설은 브라우저 음성(TTS)으로 읽고, 화면 '해설' 상자는 live 영역이 아니다 (원칙 1장).
 */
export function PlayerPractice({ done, onDone }: { done: boolean; onDone: () => void }) {
  const { announce } = useAnnouncer()
  const { speak, stop } = useAudio()
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const started = done || time > 0

  const onTick = useEffectEvent(() => {
    const next = time + 1
    if (next >= LENGTH) {
      setTime(LENGTH)
      setPlaying(false)
      announce('연습 영상이 끝났어요.')
      return
    }
    setTime(next)
    const scene = SCENES.find((s) => s.at === next)
    if (scene) speak(scene.line)
  })

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => onTick(), 1000)
    return () => clearInterval(id)
  }, [playing])

  const toggle = () => {
    if (playing) {
      setPlaying(false)
      stop()
      announce('멈췄어요.')
      return
    }
    const from = time >= LENGTH ? 0 : time
    setTime(from)
    setPlaying(true)
    onDone()
    speak(sceneAt(from).line)
  }

  const seek = (delta: number) => {
    const next = Math.min(LENGTH, Math.max(0, time + delta))
    setTime(next)
    stop()
    announce(`${withRo(formatDurationSpoken(next))} 옮겼어요.`)
  }

  const describe = () => announce(`지금 장면. ${sceneAt(time).detail}`)
  // 시청 화면과 같은 키로 연습한다 (catalog.ts)
  useShortcutEntry('play', () => toggle(), { scope: 'user' })
  useShortcutEntry('seek', (key) => seek(key === 'J' ? -STEP : STEP), { scope: 'user' })
  useShortcutEntry('describe', () => describe(), { scope: 'user' })

  // 영상 영역에 포커스가 있을 때만 좌우 화살표로 이동 (한 글자 키 규칙, 원칙 5장)
  const onVideoKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      seek(e.key === 'ArrowRight' ? STEP : -STEP)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        onKeyDown={onVideoKeyDown}
        aria-label={`연습 영상, ${playing ? '재생 중. 누르면 멈춰요' : '멈춤. 누르면 재생해요'}`}
        className="flex h-[9.5rem] w-full items-center justify-center rounded-lg bg-stage text-on-stage/70 focus-visible:bg-stage focus-visible:outline-yellow hc:border-2 hc:border-yellow"
      >
        예시 영상 · 10초 · {playing ? '재생 중' : started ? '멈춤' : '재생 전'}
      </button>

      <div className="mt-2 flex items-center gap-6 rounded-lg bg-stage px-4 py-2 hc:border-2 hc:border-yellow">
        <p aria-hidden="true" className="font-mono text-sm text-on-stage/70">
          해설
          <br />
          {formatClock(sceneAt(time).at * 1000)}
        </p>
        <p className="text-xl font-bold text-yellow">
          {started ? sceneAt(time).line : '재생을 시작하면 지금 읽는 해설이 여기에 크게 보여요.'}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={toggle} aria-keyshortcuts="Alt+Shift+K Space">
          {playing ? '일시정지' : '재생'}
        </Button>
        <Button variant="secondary" onClick={() => seek(-STEP)}>
          5초 뒤로
        </Button>
        <Button variant="secondary" onClick={() => seek(STEP)}>
          5초 앞으로
        </Button>
        <Button variant="secondary" onClick={describe} aria-keyshortcuts="Alt+Shift+D">
          장면 설명
        </Button>
        <p className="font-mono text-ink-muted">
          <span aria-hidden="true">
            {formatClock(time * 1000)} / {formatClock(LENGTH * 1000)}
          </span>
          <span className="sr-only">
            {formatDurationSpoken(time)}, 전체 {formatDurationSpoken(LENGTH)}
          </span>
        </p>
      </div>

      <StatusLine
        done={done}
        text={done ? '재생해 봤어요' : '아직 재생하지 않았어요'}
        className="mt-3"
      />
    </>
  )
}
