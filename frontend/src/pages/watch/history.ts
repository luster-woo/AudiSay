import type { ChatIntent } from '@/api/types'
import { withRo } from '@/utils/korean'
import { formatClock } from '@/utils/time'

/**
 * 질문 기록 패널의 항목 하나. 질문이든 명령(이동·설정·기능)이든 모두 같은 모양이다:
 * '나'(한 말) 말풍선 + 'AudiSay 답' 말풍선(다시 듣기 · 그 장면 보기)
 */
export type HistoryEntry =
  | { key: string; kind: 'me'; chatLogId: number; videoTimeMs: number | null; text: string }
  | {
      key: string
      kind: 'answer'
      chatLogId: number
      videoTimeMs: number | null
      text: string
      /** 스트림으로 받은 문장별 음성. 명령의 답·기록에서 불러온 답은 비어 있다 (브라우저 음성으로 다시 읽음) */
      sentences: { text: string; audioUrl: string | null }[]
      /** 아직 답을 받는 중이면 false */
      done: boolean
      /** 답 끝에 "들으시겠어요?"를 묻는 답. 읽는 동안에도 네/아니요 버튼 자리를 잡아 둔다 */
      offering?: boolean
      /** '그 장면 보기'로 갈 시각 (장면 이동이면 옮긴 시각). 없으면 버튼을 두지 않는다 ('다시 듣기'만) */
      goToMs?: number | null
    }

/** 명령(이동·설정·기능)에 대한 답 문장 */
export function commandReply(intent: ChatIntent, targetMs: number | null) {
  if ((intent === 'SEEK_TIME' || intent === 'SEEK_SCENE') && targetMs != null) {
    return `${targetMs === 0 ? '처음으로' : withRo(formatClock(targetMs))} 옮겼어요.`
  }
  if (intent === 'SEEK_TIME' || intent === 'SEEK_SCENE') return '장면을 찾지 못했어요.'
  if (intent === 'SETTING') return '설정을 바꿨어요.'
  if (intent === 'ACTION') return '실행했어요.'
  if (intent === 'SEARCH_VIDEO') return '영상을 찾았어요.'
  return '알아듣지 못했어요.'
}

/** 문장 끝에 마침표가 없으면 붙인다 (서버가 준 말을 답 말풍선에 그대로 쓸 때) */
export function sentence(text: string) {
  const t = text.trim()
  return /[.!?…]$/.test(t) ? t : `${t}.`
}
