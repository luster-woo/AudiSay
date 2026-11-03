import { useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'

export type HelpProblem = 'shortcut' | 'voice'

export function HelpTroubleshootingDialog({
  problem,
  onClose,
}: {
  problem: HelpProblem | null
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const voice = problem === 'voice'
  return (
    <Dialog
      open={problem !== null}
      onClose={onClose}
      title={voice ? '말을 알아듣지 못할 때' : '단축키가 작동하지 않을 때'}
      hideCloseButton
      initialFocusRef={closeRef}
      footer={
        <Button ref={closeRef} variant="secondary" size="xl" className="w-full" onClick={onClose}>
          닫기
        </Button>
      }
    >
      <ol className="list-decimal space-y-5 pl-6 text-lg leading-relaxed">
        {voice ? (
          <>
            <li>마이크 사용을 허용했는지, 마이크가 연결되어 있는지 확인해 주세요.</li>
            <li>
              ‘다시 말하기’를 누르고, ‘띠’ 소리 뒤에 요청을 말해 주세요. 다 말하면 ‘말 끝내기’를
              누르세요.
            </li>
            <li>
              들은 내용이 다르면 질문 입력칸의 글자를 고쳐 ‘보내기’를 누르세요. ‘글자로 묻기’로 직접
              입력할 수도 있어요.
            </li>
          </>
        ) : (
          <>
            <li>
              Alt와 Shift를 누른 채 나머지 키를 눌러 주세요. 영상 전용 키는 영상을 보는 화면에서
              사용해요.
            </li>
            <li>
              화면낭독기를 사용한다면 탐색 모드와 입력 모드를 확인해 주세요. 낭독기가 키를 먼저
              처리하면 앱에 전달되지 않을 수 있어요.
            </li>
            <li>
              브라우저나 화면낭독기에 설정한 단축키와 겹치는지 확인해 주세요. 화면의 버튼으로도 같은
              기능을 이용할 수 있어요.
            </li>
          </>
        )}
      </ol>
    </Dialog>
  )
}
