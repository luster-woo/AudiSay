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
  /**
   * 영상을 클릭했을 때 (마우스 사용자의 재생·멈춤). 유튜브 iframe 은 inert 라 자체 클릭이 막혀 있어
   * 투명 겹판이 대신 받아 재생 버튼과 같은 처리(안내·해설 중단)를 한다. 없으면 겹판을 두지 않는다
   */
  onClick?: () => void
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
  onClick,
  className,
}: VideoStageProps) {
  return (
    // 영상 상자는 보기만 하는 곳. 조작은 바깥 버튼·재생바로 하므로 낭독기에서 숨긴다
    // (유튜브 iframe 안의 '동영상 재생' 버튼 등이 읽히거나 포커스가 들어가지 않게)
    <div
      aria-hidden="true"
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
      {/* 클릭 겹판: 상자 전체가 aria-hidden 이라 낭독기·Tab 에는 없다. 일부러 버튼이 아닌 div 다 —
          키보드·낭독기 조작은 바깥의 재생 버튼(Space, Alt+Shift+K)이 맡고, 여기는 마우스만 받는다 */}
      {onClick && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          data-testid="video-click-overlay"
          className="absolute inset-0 cursor-pointer"
          onClick={onClick}
        />
      )}
    </div>
  )
}
