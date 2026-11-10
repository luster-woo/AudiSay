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
import type { ActionResult } from './Player'
import { withRo } from '@/utils/korean'
import { formatPositionSpoken } from '@/utils/time'
import { screenReaderLeadMs } from '@/features/search/speechLead'
import { commandReply, sentence, type HistoryEntry } from './history'

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
  /** 영상을 멈추고 fn 이 끝나면 이어서 재생 (resume:false 면 재생하지 않고 원래 재생 중이었는지만 돌려준다) */
  holdWhile: (fn: () => Promise<unknown>, opts?: { resume?: boolean }) => Promise<boolean>
  /** 지금 영상이 (사용자 입장에서) 재생 중인지. 답이 끝난 뒤 '재생하려면 …' 안내를 붙일지 정한다 */
  isPlaying: () => boolean
  seekTo: (ms: number, said?: string) => void
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>
  /**
   * 기능 실행. 처리하지 못한 기능이면 null, 했으면 실제 결과 문장(안내는 이미 했다)과 장면 이동 시각.
   * fromChat: 챗봇 명령이라 읽은 뒤 이어서 재생하지 않는다
   */
  runAction: (code: ChatActionCode, opts?: { fromChat?: boolean }) => ActionResult | null
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
/** 장면 후보는 이 수까지만 보인다·읽는다 (번호를 기억할 수 있게. 서버도 같은 수로 자른다) */
export const MAX_CANDIDATES = 3

/** 답이 끝난 뒤 영상이 멈춰 있으면 덧붙이는 안내 (챗봇 응답 뒤에는 자동 재생하지 않는다) */
export const PLAY_HINT = 'Alt+Shift+K를 누르면 재생해요.'

/** 답 스트림이 끝 신호(done·error) 없이 끊겼을 때 */
export const STREAM_CUT_MESSAGE = '답을 받는 중에 연결이 끊겼어요. 다시 물어봐 주세요.'

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
  // 화면 조작(재생·이동·창 열기)으로 답을 끊었으면 '답변을 멈췄어요' 안내와 입력칸 포커스 이동을 하지 않는다
  const quietStopRef = useRef(false)
  // '다시 듣기'로 읽는 중인 답 (그 자리에 '멈추기'를 둔다)
  const [replayingKey, setReplayingKey] = useState<string | null>(null)
  const replayingRef = useRef<string | null>(null)
  // 보내기 실패 기록의 key (같은 말을 여러 번 실패해도 겹치지 않게)
  const failSeqRef = useRef(0)
  // 답 소리를 이 시각 전에는 내지 않는다. 보낸 직후 낭독기가 읽는 것(친 단어, 알아들은 뒤 입력칸 이름)과 겹치지 않게
  const quietUntilRef = useRef(0)
  const ctxRef = useRef(ctx)
  useEffect(() => {
    ctxRef.current = ctx
  })

  const push = useCallback((e: HistoryEntry) => setLocal((prev) => [...prev, e]), [])
  /**
   * 질문이 아닌 말(이동·설정·기능·대답)도 질문과 같은 모양으로 남긴다: '나' 말풍선 + 'AudiSay 답' 말풍선.
   * goToMs: '그 장면 보기'로 갈 시각 (장면 이동이면 옮긴 시각)
   */
  const addReply = useCallback(
    (
      key: string,
      chatLogId: number,
      videoTimeMs: number | null,
      utterance: string,
      answer: string,
      goToMs: number | null = null,
    ) => {
      setLocal((prev) => [
        ...prev,
        { key: `me-${key}`, kind: 'me', chatLogId, videoTimeMs, text: utterance },
        {
          key: `ans-${key}`,
          kind: 'answer',
          chatLogId,
          videoTimeMs,
          text: sentence(answer),
          sentences: [],
          done: true,
          goToMs,
        },
      ])
    },
    [],
  )
  // 같은 chatLogId 에 답이 두 번 올 수 있어("들으시겠어요?" → 네) 항목 key 로 고친다
  const patchAnswer = useCallback(
    (key: string, fn: (a: Extract<HistoryEntry, { kind: 'answer' }>) => HistoryEntry) =>
      setLocal((prev) => prev.map((e) => (e.kind === 'answer' && e.key === key ? fn(e) : e))),
    [],
  )

  /**
   * QUESTION·SCENE_NOW·RECAP: 영상을 멈추고 답을 문장 단위로 듣는다 (ASK-01).
   * includeFuture: "들으시겠어요?"에 '네'라고 해서 같은 질문을 뒤 내용까지 넣어 다시 받을 때
   * 질문의 답에는 '그 장면 보기'를 달지 않는다 ("서희가 누구야?"의 답으로 물어본 시각에 갈 까닭이 없다)
   */
  const listenAnswer = useCallback(
    async (
      chatLogId: number,
      utterance: string,
      videoTimeMs: number,
      includeFuture = false,
    ) => {
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
        goToMs: null,
      })
      c.showHistory()
      const controller = new AbortController()
      abortRef.current = controller
      quietStopRef.current = false
      let answerText = ''
      // done·error 이벤트를 받았는지. 못 받고 닫히면(서버·프록시가 그냥 닫음, 45초 무응답) 실패로 본다
      let ended = false
      let failed: string | null = null
      let futureAvailable = false
      let spokeSentence = false
      // 답이 끝나도 이어서 재생하지 않는다 (챗봇 응답 뒤 자동 재생 없음). 영상은 멈춘 채로 둔다
      await c.holdWhile(
        async () => {
          // 첫 문장은 낭독기가 다 읽을 때까지 기다렸다가 낸다 (원칙 1장: 소리는 한 번에 하나)
          let chain: Promise<unknown> = new Promise((r) =>
            setTimeout(r, Math.max(0, quietUntilRef.current - Date.now())),
          )
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
                    controller.signal.aborted
                      ? undefined
                      : c.narrator.say({ text: s.text, audioUrl: s.audioUrl, rate: c.speechRate }),
                  )
                } else if (msg.event === 'done') {
                  ended = true
                  answerText = msg.data.answerText || answerText
                  futureAvailable = msg.data.futureAvailable === true
                  // 읽는 동안 버튼 자리를 네/아니요로 바꿔 둔다 (끝나야 누를 수 있다)
                  if (futureAvailable && !includeFuture)
                    patchAnswer(ansKey, (a) => (a.kind === 'answer' ? { ...a, offering: true } : a))
                  // 이미 끝난 답을 다시 받으면 sentence 없이 done 만 온다 → 답 본문도 우리 음성으로 읽는다
                  if (!spokeSentence && answerText) {
                    const text = answerText
                    chain = chain.then(() =>
                      controller.signal.aborted
                        ? undefined
                        : c.narrator.say({ text, rate: c.speechRate }),
                    )
                  }
                  resolve()
                } else {
                  ended = true
                  failed = msg.data.message || '답을 만들지 못했어요.'
                  resolve()
                }
              },
              onClose: (reason, err) => {
                if (!ended && !controller.signal.aborted)
                  failed =
                    reason === 'error' && !answerText ? toUserMessage(err) : STREAM_CUT_MESSAGE
                resolve()
              },
            })
          })
          if (!controller.signal.aborted) await chain
        },
        { resume: false },
      )
      if (abortRef.current === controller) abortRef.current = null
      const aborted = controller.signal.aborted
      const quiet = aborted && quietStopRef.current
      patchAnswer(ansKey, (a) => ({
        ...a,
        // 중간에 끊긴 답은 받은 데까지 보이고, 끊겼다는 것도 함께 남긴다
        text: answerText
          ? failed
            ? `${answerText} (${failed})`
            : answerText
          : failed
            ? `(${failed})`
            : a.text,
        done: true,
      }))
      // 답변 끝의 "들으시겠어요?"에 대한 대답을 기다린다 (다음 말이 '네'면 다시 받는다)
      const offering = !aborted && !failed && futureAvailable && !includeFuture
      setOffer(offering ? { kind: 'future', chatLogId, videoTimeMs } : null)
      // 화면 조작(재생·이동·창 열기)으로 끊었으면 그 조작의 안내·포커스를 그대로 둔다
      if (quiet) return
      // 답 본문은 우리 음성이 이미 읽었다. 낭독기는 다음에 할 일만 알린다 (같은 문장을 두 번 읽지 않게).
      // 영상은 멈춘 채로 두므로, 재생하는 방법을 덧붙인다 (입력칸에서는 Space 가 글자라 단축키로 알린다)
      const playHint = ctxRef.current.isPlaying() ? '' : ` ${PLAY_HINT}`
      const endText = aborted
        ? '답변을 멈췄어요. 입력칸에 있어요.'
        : failed
          ? `${failed}${playHint}`
          : offering
            ? "들으려면 '네', 아니면 '아니요'라고 말하거나 적어 주세요."
            : `답변이 끝났어요. 입력칸에 있어요.${playHint}`
      c.announce(endText, failed && !aborted ? { politeness: 'assertive' } : undefined)
      c.focusInput()
    },
    [push, patchAnswer],
  )

  const handle = useCallback(
    async (res: ChatMessageResult, videoTimeMs: number) => {
      const c = ctxRef.current
      const { chatLogId, utterance } = res
      const answer = (text: string, goToMs: number | null = null) =>
        addReply(String(chatLogId), chatLogId, videoTimeMs, utterance, text, goToMs)
      const command = (targetMs: number | null) =>
        answer(commandReply(res.intent, targetMs), targetMs)

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
          const { targetMs } = res.result
          // 후보는 3개까지만 (서버도 자르지만, 더 오면 여기서도 자른다)
          const candidates = res.result.candidates.slice(0, MAX_CANDIDATES)
          if (targetMs != null) {
            command(targetMs)
            c.seekTo(targetMs)
            return
          }
          if (candidates.length === 0) {
            // 서버가 이유별 말을 준다 ("못 찾았어요" / "시간이 오래 걸려요")
            const said = res.result.message || '그런 장면을 찾지 못했어요. 다르게 말씀해 주세요.'
            answer(said)
            c.announce(said)
            return
          }
          // 후보 목록은 따로 안내하지 않는다. 후보 칸이 열리며 첫 후보로 포커스가 가고, 낭독기가 묶음 이름
          // ('비슷한 장면 N곳 …')과 첫 후보를 읽는다. 안내까지 하면 같은 목록을 두 번 듣는다 (원칙 1장)
          setPending({ chatLogId, utterance, videoTimeMs, candidates })
          c.showHistory()
          return
        }
        case 'SETTING': {
          const { settingKey, settingValue, message } = res.result
          const patch = coerceSetting(settingKey, settingValue)
          if (!patch) {
            answer('바꿀 수 없는 설정이에요.')
            c.announce('바꿀 수 없는 설정이에요.')
            return
          }
          // 범위 끝이면 서버가 준 말("이미 가장 빠른 속도예요.")을 그대로 읽는다
          answer(message || `${withRo(settingSpoken(settingKey, settingValue))} 바꿨어요.`)
          await c.updateSettings(patch)
          c.announce(message || `${withRo(settingSpoken(settingKey, settingValue))} 바꿨어요.`)
          return
        }
        case 'ACTION': {
          // 재생 중 "요약 들려줘": 요약에는 뒤 내용이 있어 먼저 묻는다 (스포일러)
          if (res.result.actionCode === 'PLAY_SUMMARY' && videoTimeMs > 0) {
            answer(SUMMARY_OFFER)
            setOffer({ kind: 'summary', chatLogId, videoTimeMs })
            c.announce(`${SUMMARY_OFFER} 들으려면 '네', 아니면 '아니요'라고 말하거나 적어 주세요.`)
            c.focusInput()
            return
          }
          // 실제로 한 일(예: '이미 즐겨찾기에 있어요', '마지막 장면이에요')을 말풍선과 다시 듣기에도 같게 쓴다
          const result = c.runAction(res.result.actionCode, { fromChat: true })
          if (!result) {
            answer('이 화면에서는 할 수 없는 기능이에요.')
            c.announce('이 화면에서는 할 수 없는 기능이에요.')
            return
          }
          answer(result.said, result.goToMs)
          return
        }
        case 'SEARCH_VIDEO':
          answer(
            res.result.query
              ? `'${res.result.query}' 영상을 찾아요.`
              : res.result.message || '다른 영상은 검색 화면에서 찾아 주세요.',
          )
          // 영상 안에서는 서버가 검색어 대신 안내("다른 영상은 검색 화면에서 찾아 주세요.")만 준다
          if (res.result.query) c.searchVideos(res.result.query)
          else c.announce(res.result.message || '다른 영상은 검색 화면에서 찾아 주세요.')
          return
        default:
          answer(res.result.message || '알아듣지 못했어요. 다시 말씀해 주세요.')
          c.announce(res.result.message || '알아듣지 못했어요. 다시 말씀해 주세요.')
      }
    },
    [addReply, listenAnswer],
  )

  /** 후보 중 하나로 이동 */
  const chooseCandidate = useCallback(
    (cand: SceneCandidate) => {
      if (!pending) return
      const c = ctxRef.current
      addReply(
        String(pending.chatLogId),
        pending.chatLogId,
        pending.videoTimeMs,
        pending.utterance,
        `${cand.title}, ${commandReply('SEEK_SCENE', cand.startMs)}`,
        cand.startMs,
      )
      setPending(null)
      c.seekTo(
        cand.startMs,
        `${cand.title}, ${withRo(formatPositionSpoken(cand.startMs))} 옮겼어요.`,
      )
    },
    [pending, addReply],
  )

  const dismissCandidates = useCallback(() => {
    if (!pending) return
    const c = ctxRef.current
    addReply(
      String(pending.chatLogId),
      pending.chatLogId,
      pending.videoTimeMs,
      pending.utterance,
      '찾는 장면이 아니었어요. 다시 말씀해 주세요.',
    )
    setPending(null)
    c.focusInput()
    c.announce('다시 말씀해 주세요. 입력칸에 있어요.')
  }, [pending, addReply])

  const send = useCallback(
    async (utterance: string, inputMode: 'TEXT' | 'VOICE') => {
      const c = ctxRef.current
      if (busy) return
      // 글자: Enter 에 낭독기가 친 단어를 읽는다. 말: 알아들은 뒤 입력칸으로 돌아오며 그 이름을 읽는다
      quietUntilRef.current =
        Date.now() + screenReaderLeadMs(inputMode === 'VOICE' ? '챗봇과 대화하기, 편집창' : '')
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
        addReply(
          `${asked.chatLogId}-${asked.kind}-no`,
          asked.chatLogId,
          asked.videoTimeMs,
          utterance,
          asked.kind === 'summary'
            ? '알겠어요. 요약은 듣지 않을게요.'
            : '알겠어요. 뒤 내용은 듣지 않을게요.',
        )
        c.announce('알겠어요. 입력칸에 있어요.')
        c.focusInput()
        return
      }
      if (asked?.kind === 'summary' && reply === 'yes') {
        addReply(
          `${asked.chatLogId}-summary-yes`,
          asked.chatLogId,
          asked.videoTimeMs,
          utterance,
          '요약을 들려 드릴게요.',
        )
        c.runAction('PLAY_SUMMARY', { fromChat: true })
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
        // 답 스트림이 실패했을 때와 같은 모양으로 남긴다: '나' 말풍선 + '(오류)' 답 말풍선.
        // 적은 질문이 사라지지 않고, 기록에서 무엇이 실패했는지 보인다
        const message = toUserMessage(e)
        failSeqRef.current += 1
        addReply(
          `fail-${failSeqRef.current}`,
          0,
          videoTimeMs,
          utterance,
          `(보내지 못했어요. ${message})`,
        )
        c.announce(`보내지 못했어요. ${message}`, { politeness: 'assertive' })
        c.focusInput()
      } finally {
        setBusy(false)
      }
    },
    [busy, offer, pending, chooseCandidate, handle, listenAnswer, addReply],
  )

  /** 기록의 답을 다시 듣기 (음성이 있으면 그걸, 없으면 브라우저 음성). 읽는 동안 그 자리에 '멈추기'가 생긴다 */
  const replay = useCallback((entry: Extract<HistoryEntry, { kind: 'answer' }>) => {
    const c = ctxRef.current
    const items =
      entry.sentences.length > 0
        ? entry.sentences
        : [{ text: entry.text, audioUrl: null as string | null }]
    replayingRef.current = entry.key
    setReplayingKey(entry.key)
    void c
      .holdWhile(async () => {
        for (const s of items) {
          if (replayingRef.current !== entry.key) break
          if (!(await c.narrator.say({ text: s.text, audioUrl: s.audioUrl, rate: c.speechRate })))
            break
        }
      })
      .finally(() => {
        if (replayingRef.current === entry.key) {
          replayingRef.current = null
          setReplayingKey(null)
        }
      })
  }, [])

  /**
   * Esc·'답 멈추기': 답을 받거나 읽는 중이면, 또는 다시 듣기 중이면 멈춘다. 멈췄으면 true.
   * quiet: 화면 조작(재생·이동·창 열기)이 끊는 것이라 '답변을 멈췄어요' 안내·입력칸 포커스를 하지 않는다
   */
  const stopAnswer = useCallback(({ quiet = false }: { quiet?: boolean } = {}) => {
    if (abortRef.current) {
      quietStopRef.current = quiet
      abortRef.current.abort()
      abortRef.current = null
      ctxRef.current.narrator.stop()
      return true
    }
    if (replayingRef.current) {
      replayingRef.current = null
      setReplayingKey(null)
      ctxRef.current.narrator.stop()
      if (!quiet) ctxRef.current.announce('다시 듣기를 멈췄어요.')
      return true
    }
    return false
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
    replayingKey,
    stopAnswer,
  }
}
