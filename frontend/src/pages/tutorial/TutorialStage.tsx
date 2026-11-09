import { SHOT_HEIGHT, SHOT_WIDTH, type Rect, type TutorialScreen } from './steps'

/** 캡처 둘레 여백 (캡처 좌표 px). 화면 가장자리의 영역도 강조 테두리가 잘리지 않게 한다 */
const MARGIN = 28
/** 강조 테두리와 영역 사이 여백 (캡처 좌표 px). 테두리가 내용을 덮지 않게 한다 */
const PAD = 16

const FRAME_W = SHOT_WIDTH + MARGIN * 2
const FRAME_H = SHOT_HEIGHT + MARGIN * 2
const pctX = (v: number) => `${(v / FRAME_W) * 100}%`
const pctY = (v: number) => `${(v / FRAME_H) * 100}%`

/**
 * 예시 화면(실제 화면 캡처) + 강조 테두리. 위치를 캡처 크기에 대한 비율로 두어 화면 폭이 바뀌어도
 * 같은 자리를 가리키고, 스크롤해도 그림과 함께 움직여 어긋나지 않는다.
 * 캡처 둘레에 여백을 두어 테두리가 영역 바깥에 그려지고(내용을 가리지 않음) 가장자리에서도 잘리지 않는다.
 * 같은 화면에서 단계가 바뀌면 그림은 그대로 두고 테두리만 부드럽게 옮겨 간다 (움직임 줄이기 설정이면 바로).
 * 그림이라 낭독기에는 숨긴다 (설명은 안내창이 맡는다).
 */
export function TutorialStage({ screen, target }: { screen: TutorialScreen; target: Rect }) {
  return (
    <div
      aria-hidden="true"
      data-testid="tutorial-stage"
      className="relative w-full overflow-hidden rounded-xl border-2 border-line bg-cream shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
      style={{ aspectRatio: `${FRAME_W} / ${FRAME_H}` }}
    >
      <img
        src={screen.image}
        alt=""
        draggable={false}
        className="absolute rounded-md shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
        style={{
          left: pctX(MARGIN),
          top: pctY(MARGIN),
          width: pctX(SHOT_WIDTH),
          height: pctY(SHOT_HEIGHT),
        }}
      />
      <div
        data-testid="tutorial-highlight"
        className="pointer-events-none absolute rounded-xl border-4 border-yellow motion-safe:transition-[top,left,width,height] motion-safe:duration-300 motion-safe:ease-out"
        style={{
          left: pctX(MARGIN + target.x - PAD),
          top: pctY(MARGIN + target.y - PAD),
          width: pctX(target.w + PAD * 2),
          height: pctY(target.h + PAD * 2),
          boxShadow: '0 0 0 9999px rgba(8,15,30,0.55)',
        }}
      />
    </div>
  )
}
