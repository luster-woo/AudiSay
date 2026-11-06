import type { ChatHistoryItem, ChatIntent } from '@/api/types'
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
export const ANSWER_CUT = '답을 다 받지 못했어요'

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

/** 서버 기록(최신순) → 화면 항목(오래된 것부터, 최근 것이 아래) */
export function entriesFromServer(items: ChatHistoryItem[]): HistoryEntry[] {
  const out: HistoryEntry[] = []
  for (const m of [...items].reverse()) {
    if (m.intent === 'QUESTION' || m.intent === 'SCENE_NOW' || m.intent === 'RECAP') {
      out.push({
        key: `me-${m.chatLogId}`,
        kind: 'me',
        chatLogId: m.chatLogId,
        videoTimeMs: m.videoTimeMs,
        text: m.utterance,
      })
      // answerSource 가 null 이면 답을 끝까지 받지 못한 것 (실패·취소). 받은 데까지 + 안내
      const cut = m.answerSource === null
      if (m.answerText || cut) {
        out.push({
          key: `ans-${m.chatLogId}`,
          kind: 'answer',
          chatLogId: m.chatLogId,
          videoTimeMs: m.videoTimeMs,
          text: cut
            ? [m.answerText, `(${ANSWER_CUT})`].filter(Boolean).join(' ')
            : (m.answerText ?? ''),
          sentences: [],
          done: true,
        })
      }
    } else {
      out.push({
        key: `cmd-${m.chatLogId}`,
        kind: 'command',
        chatLogId: m.chatLogId,
        videoTimeMs: m.videoTimeMs,
        text: commandText(m.intent, m.utterance, m.targetMs),
        targetMs: m.targetMs,
      })
    }
  }
  return out
}
