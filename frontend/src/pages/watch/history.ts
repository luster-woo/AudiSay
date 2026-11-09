import type { ChatIntent } from '@/api/types'
import { withRo } from '@/utils/korean'
import { formatClock } from '@/utils/time'

/** 질문 기록 패널의 항목 하나. 질문은 '나'와 'AudiSay 답' 두 줄, 명령은 한 줄로 보인다 */
export type HistoryEntry =
  | { key: string; kind: 'me'; chatLogId: number; videoTimeMs: number | null; text: string }
  | {
      key: string
      kind: 'answer'
      chatLogId: number
      videoTimeMs: number | null
      text: string
      /** 스트림으로 받은 문장별 음성. 기록에서 불러온 답은 비어 있다 (브라우저 음성으로 다시 읽음) */
      sentences: { text: string; audioUrl: string | null }[]
      /** 아직 답을 받는 중이면 false */
      done: boolean
      /** 답 끝에 "들으시겠어요?"를 묻는 답. 읽는 동안에도 네/아니요 버튼 자리를 잡아 둔다 */
      offering?: boolean
    }
  | {
      key: string
      kind: 'command'
      chatLogId: number
      videoTimeMs: number | null
      text: string
      targetMs: number | null
    }

/** 질문 기록에서 답이 중간에 끊긴 것 */
export function commandText(intent: ChatIntent, utterance: string, targetMs: number | null) {
  const q = `"${utterance}"`
  if ((intent === 'SEEK_TIME' || intent === 'SEEK_SCENE') && targetMs != null) {
    return `${q} → ${targetMs === 0 ? '처음으로' : withRo(formatClock(targetMs))} 옮겼어요`
  }
  if (intent === 'SEEK_TIME' || intent === 'SEEK_SCENE') return `${q} → 장면을 찾지 못했어요`
  if (intent === 'SETTING') return `${q} → 설정을 바꿨어요`
  if (intent === 'ACTION') return `${q} → 실행했어요`
  if (intent === 'SEARCH_VIDEO') return `${q} → 영상을 찾았어요`
  return `${q} → 알아듣지 못했어요`
}
