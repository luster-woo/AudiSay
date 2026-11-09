import { useState } from 'react'
import analyzingImg from '@/assets/job/odi-analyzing.webp'
import analyzingStillImg from '@/assets/job/odi-analyzing-still.webp'
import askImg from '@/assets/tour/ask.webp'
import playImg from '@/assets/tour/play.webp'

type Phase = 'waiting' | 'running' | 'done' | 'failed'

// 끝나면 오디 포즈가 바뀐다: 완료 플레이 버튼 안기 · 실패 갸우뚱
const END_POSE: Record<'done' | 'failed', string> = { done: playImg, failed: askImg }

const PAUSED_KEY = 'jobMascotPaused'

/**
 * 해설 만들기 화면의 마스코트 오디. 장식이라 낭독기에 숨긴다.
 * 대기·진행 중엔 태블릿으로 영상을 보며 움직인다(움직이는 WebP).
 * 5초 넘게 저절로 움직이므로 멈춤 버튼(⏸/▶)을 두고 고른 값을 기억한다 (WCAG 2.2.2).
 * 기기의 '동작 줄이기'가 켜져 있으면 처음부터 멈춘 그림을 보여 주고 버튼도 숨긴다.
 */
export function JobMascot({ phase }: { phase: Phase }) {
  const [paused, setPaused] = useState(() => localStorage.getItem(PAUSED_KEY) === '1')

  if (phase === 'done' || phase === 'failed') {
    return (
      <img
        src={END_POSE[phase]}
        alt=""
        aria-hidden="true"
        width={320}
        height={400}
        className="h-48 w-auto shrink-0"
      />
    )
  }

  const toggle = () => {
    localStorage.setItem(PAUSED_KEY, paused ? '0' : '1')
    setPaused(!paused)
  }

  // 자동 재생 영상처럼 작은 둥근 ⏸/▶ 버튼을 그림 오른쪽 아래에 오디와 떨어뜨려 둔다. 이름은 낭독기용으로 바뀐다
  return (
    <div className="flex shrink-0 flex-col items-end gap-3">
      <picture>
        <source srcSet={analyzingStillImg} media="(prefers-reduced-motion: reduce)" />
        <img
          src={paused ? analyzingStillImg : analyzingImg}
          alt=""
          aria-hidden="true"
          width={336}
          height={288}
          className="h-48 w-auto"
        />
      </picture>
      <button
        type="button"
        onClick={toggle}
        aria-label={paused ? '캐릭터 움직임 켜기' : '캐릭터 움직임 멈추기'}
        className="flex size-touch items-center justify-center rounded-full border-2 border-navy bg-paper text-navy motion-reduce:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="currentColor">
          {paused ? (
            <path d="M8 5.5v13l10.5-6.5z" />
          ) : (
            <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
          )}
        </svg>
      </button>
    </div>
  )
}
