import { useCallback, useEffect, useRef, useState } from 'react'
import { chatApi } from '@/api/chat'
import { toUserMessage } from '@/api/errors'
import { subscribeSse } from '@/api/sse'
import type {
  ChatActionCode,
  ChatMessageResult,
  ChatStreamEvent,
  SceneCandidate,
  UserSettings,
} from '@/api/types'
import type { Narrator } from '@/features/player/Narrator'
import { formatPositionSpoken } from '@/utils/time'
import { commandText, type HistoryEntry } from './history'

export interface PendingCandidates {
  chatLogId: number
  utterance: string
  videoTimeMs: number | null
  candidates: SceneCandidate[]
}

export interface AskContext {
  videoId: number
  descriptionId: number
  narrator: Narrator
  speechRate: number
  getCurrentMs: () => number
  /** 영상을 멈추고 fn 이 끝나면 이어서 재생 */
  holdWhile: (fn: () => Promise<unknown>) => Promise<void>
  seekTo: (ms: number, said?: string) => void
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>
  runAction: (code: ChatActionCode) => void
  announce: (text: string, opts?: { politeness: 'assertive' }) => void
  /** 답이 끝난 뒤 포커스를 돌려보낼 입력칸 */
  focusInput: () => void
  /** 질문 기록 탭을 연다 (답·후보가 보이게) */
  showHistory: () => void
}

/** 설정 변경 명령의 값(문자열)을 설정 필드 타입에 맞춘다 */
function coerceSetting(key: keyof UserSettings, raw: string): Partial<UserSettings> | null {
  const num = Number(raw)
  switch (key) {
    case 'detailLevel':
      return num === 1 || num === 2 || num === 3 ? { detailLevel: num } : null
    case 'seekStepSec':
      return num === 5 || num === 10 || num === 30 ? { seekStepSec: num } : null
    case 'fontSizeLevel':
      return num >= 1 && num <= 5 ? { fontSizeLevel: num as UserSettings['fontSizeLevel'] } : null
    case 'speechRate':
      return Number.isFinite(num) ? { speechRate: Math.min(2.5, Math.max(0.5, num)) } : null
    case 'originalVolume':
      return Number.isFinite(num) ? { originalVolume: Math.min(100, Math.max(0, num)) } : null
    case 'highContrast':
      return { highContrast: raw === 'true' || raw === '1' }
    case 'narrationMode':
    case 'soundMix':
    case 'subtitleReading':
    case 'summaryMode':
    case 'voiceCode':
      return { [key]: raw } as Partial<UserSettings>
    default:
      return null
  }
}

function parseStream(event: string, data: string): ChatStreamEvent | null {
  if (!['delta', 'sentence', 'done', 'error'].includes(event)) return null
  try {
    return { event, data: JSON.parse(data) } as ChatStreamEvent
  } catch {
    return null
  }
}

/**
 * 질문·명령 처리 (CTL-03). 발화 분석 결과(intent)에 따라 답변 스트림 구독, 이동, 설정, 기능 실행을 한다.
 * 질문 기록은 서버 기록 뒤에 이 화면에서 한 것을 이어 붙인다.
 */
export function useAsk(ctx: AskContext, initial: HistoryEntry[]) {
  const [local, setLocal] = useState<HistoryEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingCandidates | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const ctxRef = useRef(ctx)
  useEffect(() => {
    ctxRef.current = ctx
  })

  const push = useCallback((e: HistoryEntry) => setLocal((prev) => [...prev, e]), [])
  const patchAnswer = useCallback(
    (chatLogId: number, fn: (a: Extract<HistoryEntry, { kind: 'answer' }>) => HistoryEntry) =>
      setLocal((prev) =>
        prev.map((e) => (e.kind === 'answer' && e.chatLogId === chatLogId ? fn(e) : e)),
      ),
    [],
  )

  /** QUESTION·SCENE_NOW: 영상을 멈추고 답을 문장 단위로 듣는다 (ASK-01) */
  const listenAnswer = useCallback(
    async (chatLogId: number, utterance: string, videoTimeMs: number) => {
      const c = ctxRef.current
      push({ key: `me-${chatLogId}`, kind: 'me', chatLogId, videoTimeMs, text: utterance })
      push({
        key: `ans-${chatLogId}`,
        kind: 'answer',
        chatLogId,
        videoTimeMs,
        text: '',
        sentences: [],
        done: false,
      })
      c.showHistory()
      const controller = new AbortController()
      abortRef.current = controller
      let answerText = ''
      let failed: string | null = null
      await c.holdWhile(async () => {
        let chain: Promise<unknown> = Promise.resolve()
        await new Promise<void>((resolve) => {
          // 끊으면(Esc) subscribeSse 는 아무것도 알리지 않으므로 여기서 직접 끝낸다
          controller.signal.addEventListener('abort', () => resolve())
          void subscribeSse(chatApi.streamPath(chatLogId), {
            signal: controller.signal,
            onMessage: ({ event, data }) => {
              const msg = parseStream(event, data)
              if (!msg) return
              if (msg.event === 'delta') {
                answerText += msg.data.text
                patchAnswer(chatLogId, (a) => ({ ...a, text: answerText }))
              } else if (msg.event === 'sentence') {
                const s = msg.data
                patchAnswer(chatLogId, (a) => ({ ...a, sentences: [...a.sentences, s] }))
                chain = chain.then(() =>
                  c.narrator.say({ text: s.text, audioUrl: s.audioUrl, rate: c.speechRate }),
                )
              } else if (msg.event === 'done') {
                answerText = msg.data.answerText || answerText
                resolve()
              } else {
                failed = msg.data.message || '답을 만들지 못했어요.'
                resolve()
              }
            },
            onClose: (reason, err) => {
              if (reason === 'error' && !answerText) failed = toUserMessage(err)
              resolve()
            },
          })
        })
        if (!controller.signal.aborted) await chain
      })
      abortRef.current = null
      const aborted = controller.signal.aborted
      patchAnswer(chatLogId, (a) => ({
        ...a,
        text: answerText || (failed ? `(${failed})` : a.text),
        done: true,
      }))
      if (aborted) c.announce('답변을 멈췄어요. 입력칸에 있어요.')
      else if (failed) c.announce(failed, { politeness: 'assertive' })
      else c.announce(`답변이 끝났어요. ${answerText}`)
      c.focusInput()
    },
    [push, patchAnswer],
  )

  const handle = useCallback(
    async (res: ChatMessageResult, videoTimeMs: number) => {
      const c = ctxRef.current
      const { chatLogId, utterance } = res
      const command = (targetMs: number | null) =>
        push({
          key: `cmd-${chatLogId}`,
          kind: 'command',
          chatLogId,
          videoTimeMs,
          text: commandText(res.intent, utterance, targetMs),
          targetMs,
        })

      switch (res.intent) {
        case 'QUESTION':
        case 'SCENE_NOW':
          await listenAnswer(chatLogId, utterance, videoTimeMs)
          return
        case 'SEEK_TIME':
          command(res.result.targetMs)
          c.seekTo(res.result.targetMs)
          return
        case 'SEEK_SCENE': {
          const { targetMs, candidates } = res.result
          if (targetMs != null) {
            command(targetMs)
            c.seekTo(targetMs)
            return
          }
          if (candidates.length === 0) {
            command(null)
            c.announce('그런 장면을 찾지 못했어요. 다르게 말씀해 주세요.')
            return
          }
          setPending({ chatLogId, utterance, videoTimeMs, candidates })
          c.showHistory()
          const list = candidates
            .map((cand, i) => `${i + 1}번, ${formatPositionSpoken(cand.startMs)}`)
            .join('. ')
          c.announce(`비슷한 장면이 ${candidates.length}곳 있어요. ${list}. 번호를 고르세요.`)
          return
        }
        case 'SETTING': {
          const patch = coerceSetting(res.result.settingKey, res.result.settingValue)
          command(null)
          if (!patch) {
            c.announce('바꿀 수 없는 설정이에요.')
            return
          }
          await c.updateSettings(patch)
          c.announce(`설정을 바꿨어요. ${res.result.settingKey} ${res.result.settingValue}.`)
          return
        }
        case 'ACTION':
          command(null)
          c.runAction(res.result.actionCode)
          return
        default:
          command(null)
          c.announce(res.result.message || '알아듣지 못했어요. 다시 말씀해 주세요.')
      }
    },
    [push, listenAnswer],
  )

  const send = useCallback(
    async (utterance: string, inputMode: 'TEXT' | 'VOICE') => {
      const c = ctxRef.current
      if (busy) return
      setBusy(true)
      const videoTimeMs = c.getCurrentMs()
      try {
        const res = await chatApi.send({
          videoId: c.videoId,
          descriptionId: c.descriptionId,
          videoTimeMs,
          utterance,
          inputMode,
        })
        await handle(res, videoTimeMs)
      } catch (e) {
        c.announce(`보내지 못했어요. ${toUserMessage(e)}`, { politeness: 'assertive' })
        c.focusInput()
      } finally {
        setBusy(false)
      }
    },
    [busy, handle],
  )

  /** 후보 중 하나로 이동 */
  const chooseCandidate = useCallback(
    (cand: SceneCandidate) => {
      if (!pending) return
      const c = ctxRef.current
      push({
        key: `cmd-${pending.chatLogId}`,
        kind: 'command',
        chatLogId: pending.chatLogId,
        videoTimeMs: pending.videoTimeMs,
        text: commandText('SEEK_SCENE', pending.utterance, cand.startMs),
        targetMs: cand.startMs,
      })
      setPending(null)
      c.seekTo(cand.startMs, `${cand.title}, ${formatPositionSpoken(cand.startMs)}으로 옮겼어요.`)
    },
    [pending, push],
  )

  const dismissCandidates = useCallback(() => {
    if (!pending) return
    const c = ctxRef.current
    push({
      key: `cmd-${pending.chatLogId}`,
      kind: 'command',
      chatLogId: pending.chatLogId,
      videoTimeMs: pending.videoTimeMs,
      text: commandText('SEEK_SCENE', pending.utterance, null),
      targetMs: null,
    })
    setPending(null)
    c.focusInput()
    c.announce('다시 말씀해 주세요. 입력칸에 있어요.')
  }, [pending, push])

  /** 기록의 답을 다시 듣기 (음성이 있으면 그걸, 없으면 브라우저 음성) */
  const replay = useCallback((entry: Extract<HistoryEntry, { kind: 'answer' }>) => {
    const c = ctxRef.current
    const items =
      entry.sentences.length > 0
        ? entry.sentences
        : [{ text: entry.text, audioUrl: null as string | null }]
    void c.holdWhile(async () => {
      for (const s of items) {
        if (!(await c.narrator.say({ text: s.text, audioUrl: s.audioUrl, rate: c.speechRate })))
          break
      }
    })
  }, [])

  /** Esc: 답을 듣는 중이면 멈춘다 */
  const stopAnswer = useCallback(() => {
    if (!abortRef.current) return false
    abortRef.current.abort()
    ctxRef.current.narrator.stop()
    return true
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  return {
    entries: [...initial, ...local],
    busy,
    pending,
    send,
    chooseCandidate,
    dismissCandidates,
    replay,
    stopAnswer,
  }
}
