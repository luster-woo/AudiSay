import type { RefObject } from 'react'
import type { Playback } from '@/api/types'
import { cn } from '@/components/ui/cn'
import { formatClock } from '@/utils/time'

export interface VideoStageProps {
  playback: Playback | undefined
  videoRef: RefObject<HTMLVideoElement | null>
  ytHostRef: RefObject<HTMLDivElement | null>
  playing: boolean
  ended: boolean
  currentMs: number
  durationMs: number
  /** 영상 소리 크기 0 ~ 100 (재생 설정) */
  volume: number
  className?: string
}

/**
 * 영상이 나오는 검은 상자. 브라우저 기본 컨트롤은 숨기고 재생바·버튼은 바깥에서 만든다.
 * 상자 안 "재생 중 · 2:14 / 4:42" 는 눈으로 보는 용도라 낭독기에는 숨긴다 (시각은 재생바가 읽는다).
 */
export function VideoStage({
  playback,
  videoRef,
  ytHostRef,
  playing,
  ended,
  currentMs,
  durationMs,
  volume,
  className,
}: VideoStageProps) {
  const status = ended ? '끝' : playing ? '재생 중' : '멈춤'
  return (
    <div
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-lg border-4 border-ink bg-ink',
        className,
      )}
    >
      {playback?.sourceType === 'UPLOAD' && playback.playbackUrl && (
        // 자막·해설은 서버 데이터로 따로 읽으므로 track 요소는 두지 않는다
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={videoRef}
          src={playback.playbackUrl}
          playsInline
          preload="metadata"
          // 소리 크기는 재생 설정을 따른다. 속성이 아니라 DOM 프로퍼티라 ref 로 넣는다
          onLoadedMetadata={(e) => {
            e.currentTarget.volume = Math.min(1, Math.max(0, volume / 100))
          }}
          className="absolute inset-0 size-full object-contain"
        />
      )}
      {playback?.sourceType === 'YOUTUBE' && (
        <div ref={ytHostRef} className="absolute inset-0 size-full [&>*]:size-full" />
      )}
      <p
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm text-cream/60',
          !playback && 'top-1/2 -translate-y-1/2 text-base',
        )}
      >
        {status} · {formatClock(currentMs)} / {formatClock(durationMs)}
      </p>
    </div>
  )
}
