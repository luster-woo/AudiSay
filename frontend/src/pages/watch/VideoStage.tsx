import type { RefObject } from 'react'
import type { Playback } from '@/api/types'
import { cn } from '@/components/ui/cn'

export interface VideoStageProps {
  playback: Playback | undefined
  videoRef: RefObject<HTMLVideoElement | null>
  ytHostRef: RefObject<HTMLDivElement | null>
  /** 영상 소리 크기 0 ~ 100 (재생 설정) */
  volume: number
  /** 전체 화면: 테두리·비율 없이 남는 자리를 다 채운다 (영상은 비율을 지켜 가운데) */
  fill?: boolean
  className?: string
}

/**
 * 영상이 나오는 검은 상자. 브라우저 기본 컨트롤은 숨기고 재생바·버튼은 바깥에서 만든다.
 * 상자 안에는 글자를 겹치지 않는다 (시각·상태는 바깥 재생바·버튼이 보여 주고 읽는다).
 */
export function VideoStage({
  playback,
  videoRef,
  ytHostRef,
  volume,
  fill = false,
  className,
}: VideoStageProps) {
  return (
    <div
      className={cn(
        'relative w-full overflow-hidden',
        fill
          ? 'min-h-0 flex-1 bg-black'
          : 'aspect-video rounded-lg border-4 border-stage bg-stage hc:border-yellow',
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
    </div>
  )
}
