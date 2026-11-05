import { useRef, useState, type FormEvent } from 'react'
import { useAnnouncer } from '@/features/announcer/context'
import { useShortcut } from '@/features/shortcuts/context'
import { Button } from '@/components/ui/Button'
import { StatusLine } from '@/components/ui/StatusLine'
import { MIC_MESSAGES, queryMic, recognitionErrorMessage } from '@/features/search/micPermission'

/** 브라우저 음성 인식 (크롬은 webkit 접두사) */
function getRecognition(): SpeechRecognition | null {
  const Ctor =
    'SpeechRecognition' in window
      ? SpeechRecognition
      : 'webkitSpeechRecognition' in window
        ? webkitSpeechRecognition
        : null
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = 'ko-KR'
  rec.interimResults = false
  rec.maxAlternatives = 1
  return rec
}

/** 4단계 연습: 말이나 글자로 질문하기. 실제 영상이 없으므로 연습용 답을 들려준다 */
export function AskPractice({ done, onDone }: { done: boolean; onDone: () => void }) {
  const { announce } = useAnnouncer()
  const inputRef = useRef<HTMLInputElement>(null)
  const [question, setQuestion] = useState('')
  const [listening, setListening] = useState(false)

  const answer = (q: string) => {
    onDone()
    announce(
      `"${q}"라고 물었어요. 연습이라 지금은 0분 0초예요. 실제 영상에서는 영상을 멈추고 답해 줘요.`,
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const q = question.trim()
    if (!q) {
      inputRef.current?.focus()
      announce('질문을 적거나 말로 묻기를 눌러 주세요.')
      return
    }
    answer(q)
  }

  const listen = async () => {
    const rec = getRecognition()
    if (!rec) {
      inputRef.current?.focus()
      announce('이 브라우저에서는 말로 묻기를 쓸 수 없어요. 질문을 글자로 적어 주세요.')
      return
    }
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript
      setQuestion(text)
      answer(text)
    }
    rec.onerror = (e) => {
      const mic = recognitionErrorMessage(e.error)
      if (mic) {
        inputRef.current?.focus()
        announce(`${mic} 질문은 글자로 적어도 돼요.`, { politeness: 'assertive' })
      } else announce('말을 알아듣지 못했어요. 다시 말씀해 주세요.')
    }
    rec.onend = () => setListening(false)
    setListening(true)
    // 처음이면 브라우저가 마이크 허용 팝업을 띄운다
    announce(
      (await queryMic()) === 'prompt' ? MIC_MESSAGES.asking : "'띠' 소리 뒤에 말씀해 주세요.",
    )
    rec.start()
  }

  // Alt+Shift+Q 하나로 질문한다: 입력창으로 옮기고 바로 듣기 시작. 말 대신 글자를 적어도 된다
  const ask = () => {
    inputRef.current?.focus()
    void listen()
  }
  useShortcut('Alt+Shift+Q', ask, { description: '질문하기 (말로, 또는 글자로)', scope: 'user' })

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-wrap gap-3">
        <input
          ref={inputRef}
          aria-label="연습 질문"
          placeholder="예: 지금 몇 분이야?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="min-h-touch min-w-0 flex-1 rounded-md border-2 border-line bg-paper px-4 text-lg"
        />
        <Button onClick={() => void listen()} loading={listening} aria-keyshortcuts="Alt+Shift+Q">
          {listening ? '듣는 중' : '말로 묻기'}
        </Button>
      </form>
      <StatusLine
        done={done}
        text={done ? '질문해 봤어요' : '아직 묻지 않았어요'}
        className="mt-3"
      />
    </>
  )
}
