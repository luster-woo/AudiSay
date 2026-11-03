import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { videosApi } from '@/api/videos'
import { queryKeys } from '@/api/queryKeys'
import type { ReviewDescription, ReviewLine } from '@/api/types'
import { cn } from '@/components/ui/cn'
import { useAudio } from '@/features/audio/useAudio'
import { usePlayerSource } from '@/features/player/usePlayerSource'
import { VideoStage } from '@/pages/watch/VideoStage'
import { formatClock } from '@/utils/time'

export interface SceneTabProps {
  review: ReviewDescription
  line: ReviewLine
  draft: string
  onDraftChange: (text: string) => void
  importance: 1 | 2 | 3
  onImportanceChange: (value: 1 | 2 | 3) => void
}

const MAX_TEXT = 500
/** 앞뒤 대사를 장면 구간 밖으로 얼마나 더 보여 줄지 */
const DIALOGUE_MARGIN_MS = 2000

/** 장면 그림 아래 작은 버튼 (Figma 91×31) */
const SMALL_BUTTON =
  'min-h-0 h-[2.0667rem] w-[6.0667rem] rounded-sm border border-line bg-paper text-[0.8rem] font-bold text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-50'

const sec = (ms: number) => (ms / 1000).toFixed(1)

/** 신고된 문장이 읽히는 빈 구간과 음성 길이를 비교한다. 고친 문장은 저장한 뒤에 음성 길이를 알 수 있다 */
function fitText(line: ReviewLine, changed: boolean) {
  const gap = line.gapEndMs - line.startMs
  if (changed || line.audioDurationMs == null) {
    return {
      over: false,
      text: `빈 구간 ${sec(gap)}초 · 음성 길이는 저장하고 음성이 만들어진 뒤에 다시 계산해요`,
    }
  }
  const over = line.audioDurationMs - gap
  return over > 0
    ? {
        over: true,
        text: `${sec(over)}초 넘침 · 빈 구간 ${sec(gap)}초, 음성 ${sec(line.audioDurationMs)}초`,
      }
    : {
        over: false,
        text: `빈 구간 ${sec(gap)}초 안에 들어가요 · 음성 ${sec(line.audioDurationMs)}초`,
      }
}

/**
 * 장면 탭: 장면 영상·설명·앞뒤 대사를 보고 해설 문장을 고친다.
 * 영상은 시청 화면과 같은 플레이어(GET /videos/{id}/playback)로 그 장면 시작에 맞춰 두고,
 * '구간 재생'은 장면 구간만 틀면서 신고된 문장 시각에 그 문장 음성(audioUrl)을 함께 들려준다.
 */
export function SceneTab({
  review,
  line,
  draft,
  onDraftChange,
  importance,
  onImportanceChange,
}: SceneTabProps) {
  const textId = useId()
  const fitId = useId()
  const importanceName = useId()
  const descId = useId()
  const dialogueId = useId()
  const scenes = review.scenes
  const lineScene = Math.max(
    0,
    scenes.findIndex((s) => s.startMs <= line.startMs && line.startMs < s.endMs),
  )
  const [index, setIndex] = useState(lineScene)
  const scene = scenes[index]
  const { play, stop } = useAudio()

  const playbackQ = useQuery({
    queryKey: queryKeys.playback(review.videoId),
    queryFn: () => videosApi.playback(review.videoId),
    staleTime: 30 * 60_000,
  })
  const { videoRef, ytHostRef, state, controls } = usePlayerSource(playbackQ.data, 0)

  // 장면을 바꾸거나 플레이어가 준비되면 그 장면 시작으로 옮겨 둔다
  const sceneStart = scene?.startMs ?? 0
  useEffect(() => {
    if (!state.ready) return
    controls.pause()
    controls.seek(sceneStart)
  }, [state.ready, sceneStart, controls])

  // 구간 재생 중: 장면 끝에서 멈추고, 문장 시각을 지나면 그 문장 음성을 한 번 들려준다
  const segmentRef = useRef(false)
  const lineSpokenRef = useRef(false)
  const segmentEnd = scene?.endMs ?? 0
  useEffect(() => {
    if (!segmentRef.current || !state.playing) return
    if (state.currentMs >= segmentEnd) {
      segmentRef.current = false
      controls.pause()
      return
    }
    if (!lineSpokenRef.current && state.currentMs >= line.startMs) {
      lineSpokenRef.current = true
      void play(line.audioUrl, { text: line.text })
    }
  }, [state.currentMs, state.playing, segmentEnd, line, controls, play])
  useEffect(() => () => stop(), [stop])

  const overlaps = <T extends { startMs: number; endMs: number }>(items: T[], margin: number) =>
    scene
      ? items.filter((it) => it.endMs > scene.startMs - margin && it.startMs < scene.endMs + margin)
      : []
  // 대사는 장면 경계를 넘나들어 앞뒤를 조금 더 보여 주고, 화면 글자는 그 장면 것만
  const dialogues = overlaps(review.dialogues, DIALOGUE_MARGIN_MS)

  // 장면 탭에서는 구간 재생으로만 영상을 트므로, 재생 중이면 곧 구간 재생 중이다
  const playingSegment = state.playing
  const toggleSegment = () => {
    if (playingSegment) {
      segmentRef.current = false
      controls.pause()
      stop()
      return
    }
    stop()
    // 영상을 못 불러오면 문장 음성만 들려준다 (음성이 없으면 브라우저 음성으로 읽는다)
    if (!state.ready || !scene) {
      void play(line.audioUrl, { text: line.text })
      return
    }
    segmentRef.current = true
    // 문장이 이 장면 안에 있을 때만 음성을 겹쳐 들려준다
    lineSpokenRef.current = !(line.startMs >= scene.startMs && line.startMs < scene.endMs)
    controls.seek(scene.startMs)
    controls.play()
  }

  const fit = fitText(line, draft.trim() !== line.text)

  // 치수는 Figma 장면 탭 기준 (관리자 글자 크기 15px = 1rem)
  return (
    <div>
      {scene && (
        <section aria-label="장면">
          {/* 영상은 가운데에 크게, 설명·대사는 그 아래 */}
          <div className="mx-auto w-full max-w-[48rem]">
            <div className="relative">
              <VideoStage
                playback={playbackQ.data}
                videoRef={videoRef}
                ytHostRef={ytHostRef}
                volume={100}
                className="rounded-sm border-0"
              />
              {playbackQ.isError && (
                <p className="absolute inset-0 flex items-center justify-center font-mono text-[0.8667rem] text-line">
                  영상을 불러오지 못했어요 · {formatClock(scene.startMs)} –{' '}
                  {formatClock(scene.endMs)} 구간
                </p>
              )}
            </div>
            <div className="mt-[0.8667rem] flex justify-center gap-[0.6rem]">
              <button
                type="button"
                aria-label="앞 장면"
                aria-disabled={index === 0 || undefined}
                onClick={() => index > 0 && setIndex(index - 1)}
                className={SMALL_BUTTON}
              >
                ◀ 앞
              </button>
              <button type="button" onClick={toggleSegment} className={SMALL_BUTTON}>
                {playingSegment ? '❚❚ 멈춤' : '▶ 구간 재생'}
              </button>
              <button
                type="button"
                aria-label="다음 장면"
                aria-disabled={index === scenes.length - 1 || undefined}
                onClick={() => index < scenes.length - 1 && setIndex(index + 1)}
                className={SMALL_BUTTON}
              >
                다음 ▶
              </button>
            </div>
          </div>

          {/* 장면 설명과 앞뒤 대사는 칸을 나눠 보여 준다 */}
          <div className="mt-[1.4667rem] grid gap-[1.0667rem] xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section
              aria-labelledby={descId}
              className="rounded-md border border-line bg-paper p-[1.2rem]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 id={descId} className="text-[1rem] font-bold">
                  장면 설명 <span className="font-normal text-ink-muted">(AI)</span>
                </h3>
                <p className="text-[0.8667rem] text-ink-muted">
                  {scene.sceneIndex}. {scene.title} ·{' '}
                  <span className="font-mono">
                    {formatClock(scene.startMs)} – {formatClock(scene.endMs)}
                  </span>
                </p>
              </div>
              <p className="mt-[0.8rem] text-[1.0667rem] leading-relaxed">
                {scene.sceneDescription}
              </p>
            </section>

            <section
              aria-labelledby={dialogueId}
              className="rounded-md border border-line bg-paper p-[1.2rem]"
            >
              <h3 id={dialogueId} className="text-[1rem] font-bold">
                앞뒤 대사
              </h3>
              {dialogues.length === 0 ? (
                <p className="mt-[0.8rem] text-[1rem] text-ink-muted">이 장면에는 대사가 없어요.</p>
              ) : (
                <ul className="mt-[0.5333rem] divide-y divide-line">
                  {dialogues.map((d) => (
                    <li
                      key={`${d.startMs}-${d.text}`}
                      className="flex gap-[0.8rem] py-[0.5333rem] text-[1.0667rem] leading-snug"
                    >
                      <span className="w-[2.8rem] shrink-0 pt-[0.1333rem] font-mono text-[0.8667rem] text-ink-muted">
                        {formatClock(d.startMs)}
                      </span>
                      <span className="min-w-0">
                        {d.characterName && (
                          <span className="mr-1 font-bold">{d.characterName}</span>
                        )}
                        {d.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </section>
      )}

      <section aria-label="해설 문장 고치기" className="mt-[2.2rem]">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={textId} className="text-[0.8rem] text-ink-muted">
            해설 문장 · {line.detailLevel}단계
          </label>
          <fieldset className="flex items-center gap-[0.6rem]">
            <legend className="float-left mr-[0.6rem] text-[0.8rem] text-ink-muted">중요도</legend>
            <div className="flex h-[1.8667rem] w-[6.2667rem] rounded-full bg-navy p-[0.1333rem]">
              {([1, 2, 3] as const).map((v) => (
                <label
                  key={v}
                  className={cn(
                    'flex flex-1 cursor-pointer items-center justify-center rounded-full text-[0.8667rem] font-bold text-cream',
                    'has-[:checked]:bg-paper has-[:checked]:text-navy',
                    'has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-yellow has-[:focus-visible]:outline-solid',
                  )}
                >
                  <input
                    type="radio"
                    name={importanceName}
                    value={v}
                    checked={importance === v}
                    onChange={() => onImportanceChange(v)}
                    className="sr-only"
                  />
                  {v}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <textarea
          id={textId}
          value={draft}
          maxLength={MAX_TEXT}
          rows={2}
          aria-describedby={fitId}
          onChange={(e) => onDraftChange(e.target.value)}
          className="mt-[0.7333rem] block w-full resize-y rounded-sm border border-line bg-paper px-[0.8667rem] py-[0.6667rem] text-[0.9333rem] leading-relaxed focus-visible:border-ink"
        />
        <p
          id={fitId}
          className={cn(
            'mt-[0.8rem] flex min-h-[2.1333rem] items-center justify-between gap-3 rounded-sm px-[0.8667rem] text-[0.8rem]',
            fit.over ? 'bg-danger-soft text-danger' : 'bg-line/40 text-ink-muted',
          )}
        >
          <span>{fit.text}</span>
          <span className="shrink-0 text-ink-muted">자동 계산</span>
        </p>
      </section>
    </div>
  )
}
