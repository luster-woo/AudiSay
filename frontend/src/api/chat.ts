import { request } from './client'
import type { ChatMessageBody, ChatMessageResult } from './types'

/** 챗봇. 한 입력창으로 질문·장면 이동·설정 변경·기능 실행을 받는다 */
export const chatApi = {
  /** 발화 분석. intent 에 따라 FE 가 할 일이 정해진다 */
  send: (body: ChatMessageBody) =>
    request<ChatMessageResult>({ method: 'POST', url: '/chat/messages', data: body }),
  /**
   * QUESTION·SCENE_NOW·RECAP 답변 스트림 경로 (subscribeSse 에 넘긴다).
   * includeFuture: "들으시겠어요?"에 그러겠다고 했을 때, 질문한 시각 뒤 내용까지 넣어 한 번 더 답을 받는다
   */
  streamPath: (chatLogId: number, includeFuture = false) =>
    `/chat/messages/${chatLogId}/stream${includeFuture ? '?includeFuture=true' : ''}`,
}
