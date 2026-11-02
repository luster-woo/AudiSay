import { useId, useState } from 'react'
import type { ReviewDescription, ReviewLine } from '@/api/types'
import { cn } from '@/components/ui/cn'
import { useAudio } from '@/features/audio/useAudio'
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
        text: `${sec(over)}초 넘침 · 빈 구간 ${sec(gap)}초, 음성 ${sec(line.audioDurationMs)}초 — 영상이 잠깐 멈춰요`,
      }
    : {
        over: false,
        text: `빈 구간 ${sec(gap)}초 안에 들어가요 · 음성 ${sec(line.audioDurationMs)}초`,
      }
}

/** 장면 탭: 장면 그림·설명·앞뒤 대사·화면 글자를 보고 해설 문장을 고친다 */
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
  const scenes = review.scenes
  const lineScene = Math.max(
    0,
    scenes.findIndex((s) => s.startMs <= line.startMs && line.startMs < s.endMs),
  )
  const [index, setIndex] = useState(lineScene)
  const scene = scenes[index]
  const { play } = useAudio()

  const overlaps = <T extends { startMs: number; endMs: number }>(items: T[], margin: number) =>
    scene
      ? items.filter((it) => it.endMs > scene.startMs - margin && it.startMs < scene.endMs + margin)
      : []
  // 대사는 장면 경계를 넘나들어 앞뒤를 조금 더 보여 주고, 화면 글자는 그 장면 것만
  const dialogues = overlaps(review.dialogues, DIALOGUE_MARGIN_MS)
  const screenTexts = overlaps(review.screenTexts, 0)

  // 구간 재생: 영상 플레이어가 아직 없어 이 구간의 해설 음성을 들려준다.
  // 음성이 아직 없으면(다시 만드는 중) 플레이어처럼 브라우저 음성으로 읽는다
  const playLine = () => void play(line.audioUrl, { text: line.text })

  const fit = fitText(line, draft.trim() !== line.text)

  // 치수는 Figma 장면 탭 기준 (관리자 글자 크기 15px = 1rem)
  return (
    <div>
      {scene && (
        <section aria-label="장면" className="flex gap-[1.6rem]">
          <div className="w-[26.6667rem] shrink-0">
            {scene.keyframeUrl ? (
              <img
                src={scene.keyframeUrl}
                alt={`${scene.sceneIndex}. ${scene.title} 대표 장면`}
                className="h-[15rem] w-full rounded-sm bg-ink object-cover"
              />
            ) : (
              <div
                role="img"
                aria-label={`${scene.sceneIndex}. ${scene.title}, ${formatClock(scene.startMs)}부터 ${formatClock(scene.endMs)}까지`}
                className="flex h-[15rem] w-full items-center justify-center rounded-sm bg-ink font-mono text-[0.8667rem] text-line"
              >
                {formatClock(scene.startMs)} – {formatClock(scene.endMs)} 구간
              </div>
            )}
            <div className="mt-[0.8667rem] flex gap-[0.6rem]">
              <button
                type="button"
                aria-label="앞 장면"
                aria-disabled={index === 0 || undefined}
                onClick={() => index > 0 && setIndex(index - 1)}
                className={SMALL_BUTTON}
              >
                ◀ 앞
              </button>
              <button type="button" onClick={playLine} className={SMALL_BUTTON}>
                ▶ 구간 재생
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

          <dl className="min-w-0 flex-1 space-y-[0.8rem] text-[0.9333rem] leading-snug">
            <div>
              <dt className="text-[0.8rem] text-ink-muted">장면 설명 (AI)</dt>
              <dd className="mt-0.5">{scene.sceneDescription}</dd>
            </div>
            {dialogues.length > 0 && (
              <div>
                <dt className="text-[0.8rem] text-ink-muted">앞뒤 대사</dt>
                {dialogues.map((d) => (
                  <dd key={`${d.startMs}-${d.text}`} className="mt-0.5">
                    {formatClock(d.startMs)} “{d.text}”
                  </dd>
                ))}
              </div>
            )}
            {screenTexts.map((t) => (
              <div key={t.screenTextId}>
                <dt className="text-[0.8rem] text-ink-muted">화면 글자 · 중요도 {t.importance}</dt>
                <dd className="mt-0.5">“{t.fullText}”</dd>
              </div>
            ))}
          </dl>
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
