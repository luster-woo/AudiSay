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
import { withRo } from '@/utils/korean'
import { formatPositionSpoken } from '@/utils/time'
import { commandText, type HistoryEntry } from './history'

export interface PendingCandidates {
  chatLogId: number
  utterance: string
  videoTimeMs: number | null
  candidates: SceneCandidate[]
}

/**
 * "들으시겠어요?"를 물은 상태. 다음 말이 '네'면
 * - future: 같은 답변을 뒤 내용까지 넣어 다시 받는다
 * - summary: 재생 중 "요약 들려줘" — 요약에 뒤 내용이 있어 물어본 뒤 들려준다
 */
export interface FutureOffer {
  kind: 'future' | 'summary'
  chatLogId: number
  videoTimeMs: number
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
  /** 기능 실행. 이 화면에서 처리하지 못한 기능이면 false */
  runAction: (code: ChatActionCode) => boolean
  /** 다른 영상 찾기 (SEARCH_VIDEO) */
  searchVideos: (query: string) => void
  announce: (text: string, opts?: { politeness: 'assertive' }) => void
  /** 답이 끝난 뒤 포커스를 돌려보낼 입력칸 */
  focusInput: () => void
  /** 질문 기록 탭을 연다 (답·후보가 보이게) */
  showHistory: () => void
}

/** 설정 이름과 값을 말로 ("말하기 속도 1.4배") */
const SETTING_LABEL: Partial<Record<keyof UserSettings, string>> = {
  detailLevel: '해설 상세도',
  speechRate: '말하기 속도',
  originalVolume: '영상 소리 크기',
  seekStepSec: '앞뒤 이동 간격',
  fontSizeLevel: '글자 크기',
  highContrast: '고대비 화면',
  narrationMode: '해설 방식',
  soundMix: '소리 구성',
  subtitleReading: '자막 읽기',
  summaryMode: '재생 전 요약',
}
const VALUE_LABEL: Record<string, string> = {
  AUTO: '자동',
  WITH_VIDEO: '영상과 함께',
  PAUSE_AFTER: '멈춘 후 해설',
  DIALOGUE_ONLY: '대사만',
  DIALOGUE_AND_NARRATION: '대사와 해설',
  ALL: '모두 읽기',
  DIFFERENT_ONLY: '말과 다른 자막만',
  OFF: '끄기',
  ASK: '물어보기',
  ALWAYS: '항상 듣기',
  NEVER: '듣지 않기',
}
export function settingSpoken(key: keyof UserSettings, raw: string) {
  const name = SETTING_LABEL[key] ?? '설정'
  const value =
    key === 'detailLevel'
      ? ({ '1': '짧은 해설', '2': '기본 해설', '3': '자세한 해설' } as Record<string, string>)[raw]
      : key === 'speechRate'
        ? `${raw}배`
        : key === 'originalVolume'
          ? `${raw}퍼센트`
          : key === 'seekStepSec'
            ? `${raw}초`
            : key === 'fontSizeLevel'
              ? `${raw}단계`
              : key === 'highContrast'
                ? raw === 'true' || raw === '1'
                  ? '켜기'
                  : '끄기'
                : VALUE_LABEL[raw]
  return `${name}${value ? ` ${value}` : ''}`
}

/** 재생 중 요약을 청했을 때 먼저 묻는 말 */
export const SUMMARY_OFFER = '요약에는 뒤 내용이 있어요. 들으시겠어요?'

/** "들으시겠어요?" 다음 말이 그러겠다는 뜻인지 / 아니라는 뜻인지. 둘 다 아니면 새 질문으로 처리한다 */
const YES = /^(네|넵|예|응|웅|그래|좋아|좋아요|들을게|들려|들어|듣고|듣기|계속|ㅇㅇ|ok|오케이)/i
/** "네 번째 장면", "세 개"처럼 수를 말하는 '네'는 대답이 아니다 */
const COUNTING = /^(네|세)\s*(번|개|명|시|분|초|살|가지|째)/
const NO = /^(아니요|아니|아뇨|아냐|싫어|됐어|괜찮아|괜찮습니다|안 들|안들|나중에|ㄴㄴ|no)/i
export function answerToOffer(utterance: string): 'yes' | 'no' | null {
  const t = utterance.trim().replace(/^[\s"'“”‘’.,!?~]+/, '')
  const no = NO.exec(t)
  if (no) {
    // "아니, 다음 장면으로 가 줘"처럼 뒤에 다른 명령이 이어지면 거절이 아니라 새 명령으로 본다
    const rest = t.slice(no[0].length).replace(/^[\s,.!?~요]+/, '')
    return rest.split(/\s+/).filter(Boolean).length <= 3 ? 'no' : null
  }
  if (YES.test(t) && !COUNTING.test(t)) return 'yes'
  return null
}

const KOREAN_NUMBERS: Record<string, number> = {
  첫: 1,
  한: 1,
  하나: 1,
  일: 1,
  두: 2,
  둘: 2,
  이: 2,
  세: 3,
  셋: 3,
  삼: 3,
  네: 4,
  넷: 4,
  사: 4,
  다섯: 5,
  오: 5,
  여섯: 6,
  육: 6,
  일곱: 7,
  칠: 7,
  여덟: 8,
  팔: 8,
  아홉: 9,
  구: 9,
  열: 10,
  십: 10,
}
const CANDIDATE_NUMBER =
  /^(\d+|첫|한|하나|일|두|둘|이|세|셋|삼|네|넷|사|다섯|오|여섯|육|일곱|칠|여덟|팔|아홉|구|열|십)(번째|번|째)?(거|것|꺼|장면|후보)?(이요|요)?(으로|로)?(가줘|가요|가|이동해줘|이동|골라줘|고를게요|고를게|할게요|할게|선택|보여줘)?(요)?$/
/**
 * 장면 후보를 고르는 말이면 그 번호(1부터): "2번", "2", "두 번째", "첫 번째 거", "삼 번으로 가 줘". 아니면 null.
 * 숫자가 아닌 말은 '번·번째'가 있어야 한다("네"는 대답, "이"는 지시어)
 */
export function candidateNumber(utterance: string): number | null {
  const m = CANDIDATE_NUMBER.exec(utterance.replace(/[\s.!?~,"'“”]/g, ''))
  if (!m) return null
  const [, word, unit] = m
  const digits = /^\d+$/.test(word)
  if (!digits && !unit) return null
  const n = digits ? Number(word) : KOREAN_NUMBERS[word]
  return n >= 1 ? n : null
}

/** 후보를 읽어 줄 이름: 장면 이름이 겹치면 찾은 문장으로 구분한다 */
function candidateLabel(cand: SceneCandidate, all: SceneCandidate[]) {
  const same = all.filter((c) => c.title === cand.title).length > 1
  return same && cand.summary ? cand.summary : cand.title
}

/** 설정 변경 명령의 값(문자열)을 설정 필드 타입에 맞춘다 */
export function coerceSetting(key: keyof UserSettings, raw: string): Partial<UserSettings> | null {
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
  const [offer, setOffer] = useState<FutureOffer | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const ctxRef = useRef(ctx)
  useEffect(() => {
    ctxRef.current = ctx
  })

  const push = useCallback((e: HistoryEntry) => setLocal((prev) => [...prev, e]), [])
  // 같은 chatLogId 에 답이 두 번 올 수 있어("들으시겠어요?" → 네) 항목 key 로 고친다
  const patchAnswer = useCallback(
    (key: string, fn: (a: Extract<HistoryEntry, { kind: 'answer' }>) => HistoryEntry) =>
      setLocal((prev) => prev.map((e) => (e.kind === 'answer' && e.key === key ? fn(e) : e))),
    [],
  )

  /**
   * QUESTION·SCENE_NOW·RECAP: 영상을 멈추고 답을 문장 단위로 듣는다 (ASK-01).
   * includeFuture: "들으시겠어요?"에 '네'라고 해서 같은 질문을 뒤 내용까지 넣어 다시 받을 때
   */
  const listenAnswer = useCallback(
    async (chatLogId: number, utterance: string, videoTimeMs: number, includeFuture = false) => {
      const c = ctxRef.current
      const suffix = includeFuture ? '-future' : ''
      const ansKey = `ans-${chatLogId}${suffix}`
      push({
        key: `me-${chatLogId}${suffix}`,
        kind: 'me',
        chatLogId,
        videoTimeMs,
        text: utterance,
      })
      push({
        key: ansKey,
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
      let futureAvailable = false
      let spokeSentence = false
      await c.holdWhile(async () => {
        let chain: Promise<unknown> = Promise.resolve()
        await new Promise<void>((resolve) => {
          // 끊으면(Esc) subscribeSse 는 아무것도 알리지 않으므로 여기서 직접 끝낸다
          controller.signal.addEventListener('abort', () => resolve())
          void subscribeSse(chatApi.streamPath(chatLogId, includeFuture), {
            signal: controller.signal,
            onMessage: ({ event, data }) => {
              const msg = parseStream(event, data)
              if (!msg) return
              if (msg.event === 'delta') {
                answerText += msg.data.text
                patchAnswer(ansKey, (a) => ({ ...a, text: answerText }))
              } else if (msg.event === 'sentence') {
                const s = msg.data
                spokeSentence = true
                patchAnswer(ansKey, (a) => ({ ...a, sentences: [...a.sentences, s] }))
                chain = chain.then(() =>
                  c.narrator.say({ text: s.text, audioUrl: s.audioUrl, rate: c.speechRate }),
                )
              } else if (msg.event === 'done') {
                answerText = msg.data.answerText || answerText
                futureAvailable = msg.data.futureAvailable === true
                // 이미 끝난 답을 다시 받으면 sentence 없이 done 만 온다 → 답 본문도 우리 음성으로 읽는다
                if (!spokeSentence && answerText) {
                  const text = answerText
                  chain = chain.then(() => c.narrator.say({ text, rate: c.speechRate }))
                }
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
      patchAnswer(ansKey, (a) => ({
        ...a,
        text: answerText || (failed ? `(${failed})` : a.text),
        done: true,
      }))
      // 답변 끝의 "들으시겠어요?"에 대한 대답을 기다린다 (다음 말이 '네'면 다시 받는다)
      const offering = !aborted && !failed && futureAvailable && !includeFuture
      setOffer(offering ? { kind: 'future', chatLogId, videoTimeMs } : null)
      if (aborted) c.announce('답변을 멈췄어요. 입력칸에 있어요.')
      else if (failed) c.announce(failed, { politeness: 'assertive' })
      // 답 본문은 우리 음성이 이미 읽었다. 낭독기는 다음에 할 일만 알린다 (같은 문장을 두 번 읽지 않게)
      else if (offering) c.announce("들으려면 '네', 아니면 '아니요'라고 말하거나 적어 주세요.")
      else c.announce('답변이 끝났어요. 입력칸에 있어요.')
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
        case 'RECAP':
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
            // 서버가 이유별 말을 준다 ("못 찾았어요" / "시간이 오래 걸려요")
            const said = res.result.message || '그런 장면을 찾지 못했어요. 다르게 말씀해 주세요.'
            push({
              key: `cmd-${chatLogId}`,
              kind: 'command',
              chatLogId,
              videoTimeMs,
              text: `"${utterance}" → ${said}`,
              targetMs: null,
            })
            c.announce(said)
            return
          }
          setPending({ chatLogId, utterance, videoTimeMs, candidates })
          c.showHistory()
          const list = candidates
            .map(
              (cand, i) =>
                `${i + 1}번, ${candidateLabel(cand, candidates)}, ${formatPositionSpoken(cand.startMs)}`,
            )
            .join('. ')
          c.announce(`비슷한 장면이 ${candidates.length}곳 있어요. ${list}. 번호를 고르세요.`)
          return
        }
        case 'SETTING': {
          const { settingKey, settingValue, message } = res.result
          const patch = coerceSetting(settingKey, settingValue)
          if (!patch) {
            push({
              key: `cmd-${chatLogId}`,
              kind: 'command',
              chatLogId,
              videoTimeMs,
              text: `"${utterance}" → 바꿀 수 없는 설정이에요`,
              targetMs: null,
            })
            c.announce('바꿀 수 없는 설정이에요.')
            return
          }
          // 범위 끝이면 서버가 준 말("이미 가장 빠른 속도예요.")을 그대로 읽는다
          push({
            key: `cmd-${chatLogId}`,
            kind: 'command',
            chatLogId,
            videoTimeMs,
            text: `"${utterance}" → ${message || `${withRo(settingSpoken(settingKey, settingValue))} 바꿨어요`}`,
            targetMs: null,
          })
          await c.updateSettings(patch)
          c.announce(message || `${withRo(settingSpoken(settingKey, settingValue))} 바꿨어요.`)
          return
        }
        case 'ACTION': {
          // 재생 중 "요약 들려줘": 요약에는 뒤 내용이 있어 먼저 묻는다 (스포일러)
          if (res.result.actionCode === 'PLAY_SUMMARY' && videoTimeMs > 0) {
            push({
              key: `cmd-${chatLogId}`,
              kind: 'command',
              chatLogId,
              videoTimeMs,
              text: `"${utterance}" → ${SUMMARY_OFFER}`,
              targetMs: null,
            })
            setOffer({ kind: 'summary', chatLogId, videoTimeMs })
            c.announce(`${SUMMARY_OFFER} 들으려면 '네', 아니면 '아니요'라고 말하거나 적어 주세요.`)
            c.focusInput()
            return
          }
          const done = c.runAction(res.result.actionCode)
          push({
            key: `cmd-${chatLogId}`,
            kind: 'command',
            chatLogId,
            videoTimeMs,
            text: done
              ? commandText('ACTION', utterance, null)
              : `"${utterance}" → 이 화면에서는 할 수 없는 기능이에요`,
            targetMs: null,
          })
          if (!done) c.announce('이 화면에서는 할 수 없는 기능이에요.')
          return
        }
        case 'SEARCH_VIDEO':
          command(null)
          // 영상 안에서는 서버가 검색어 대신 안내("다른 영상은 검색 화면에서 찾아 주세요.")만 준다
          if (res.result.query) c.searchVideos(res.result.query)
          else c.announce(res.result.message || '다른 영상은 검색 화면에서 찾아 주세요.')
          return
        default:
          command(null)
          c.announce(res.result.message || '알아듣지 못했어요. 다시 말씀해 주세요.')
      }
    },
    [push, listenAnswer],
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
      c.seekTo(
        cand.startMs,
        `${cand.title}, ${withRo(formatPositionSpoken(cand.startMs))} 옮겼어요.`,
      )
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

  const send = useCallback(
    async (utterance: string, inputMode: 'TEXT' | 'VOICE') => {
      const c = ctxRef.current
      if (busy) return
      // 장면 후보를 읽어 준 뒤 "2번"·"두 번째"라고 말하거나 적으면 그 후보로 옮긴다 (서버로 보내지 않는다)
      const picked = pending ? candidateNumber(utterance) : null
      if (pending && picked !== null) {
        const cand = pending.candidates[picked - 1]
        if (cand) chooseCandidate(cand)
        else
          c.announce(
            `${picked}번 후보는 없어요. 1번부터 ${pending.candidates.length}번 중에서 골라 주세요.`,
          )
        return
      }
      // 바로 앞 답변이 "들으시겠어요?"를 물었으면 이 말이 그 대답인지 먼저 본다
      const asked = offer
      setOffer(null)
      const reply = asked ? answerToOffer(utterance) : null
      if (asked && reply === 'no') {
        push({
          key: `cmd-${asked.chatLogId}-${asked.kind}`,
          kind: 'command',
          chatLogId: asked.chatLogId,
          videoTimeMs: asked.videoTimeMs,
          text: `"${utterance}" → ${asked.kind === 'summary' ? '요약은 듣지 않았어요' : '뒤 내용은 듣지 않았어요'}`,
          targetMs: null,
        })
        c.announce('알겠어요. 입력칸에 있어요.')
        c.focusInput()
        return
      }
      if (asked?.kind === 'summary' && reply === 'yes') {
        push({
          key: `cmd-${asked.chatLogId}-summary`,
          kind: 'command',
          chatLogId: asked.chatLogId,
          videoTimeMs: asked.videoTimeMs,
          text: `"${utterance}" → 요약을 들었어요`,
          targetMs: null,
        })
        c.runAction('PLAY_SUMMARY')
        return
      }
      setBusy(true)
      const videoTimeMs = c.getCurrentMs()
      if (asked && reply === 'yes') {
        try {
          await listenAnswer(asked.chatLogId, utterance, asked.videoTimeMs, true)
        } finally {
          setBusy(false)
        }
        return
      }
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
    [busy, offer, pending, chooseCandidate, handle, listenAnswer, push],
  )

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
    offer,
    send,
    chooseCandidate,
    dismissCandidates,
    replay,
    stopAnswer,
  }
}
