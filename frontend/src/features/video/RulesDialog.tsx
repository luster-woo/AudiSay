import { useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'

/** '이용 조건 보기' — 해설을 만들 수 없는 영상 목록 */
export function RulesDialog({
  open,
  onClose,
  maxMinutes,
}: {
  open: boolean
  onClose: () => void
  /** 지금 등급의 길이 제한(분). 관리자는 null */
  maxMinutes: number | null
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="해설을 만들 수 없는 영상"
      // 목록을 창 설명으로 연결해 열자마자 읽히게 한다 (11-09 NVDA 실측: 제목과 닫기만 읽혔다)
      description={
        <ul className="mt-2 list-disc space-y-5 pl-7 text-2xl text-ink">
          <li>비공개 또는 삭제된 영상</li>
          <li>다른 사이트에서 재생을 막은 영상</li>
          <li>연령 제한이 있는 영상</li>
          <li>실시간 방송</li>
          {maxMinutes != null && <li>현재 등급의 길이 제한({maxMinutes}분)을 넘는 영상</li>}
        </ul>
      }
      hideCloseButton
      initialFocusRef={closeRef}
    >
      <Button
        ref={closeRef}
        variant="secondary"
        size="xl"
        className="mt-12 min-h-16 w-full"
        onClick={onClose}
      >
        닫기
      </Button>
    </Dialog>
  )
}
