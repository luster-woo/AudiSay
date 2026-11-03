import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { Tabs } from '@/components/ui/Tabs'
import { useAnnouncer } from '@/features/announcer/context'
import { HelpReferenceTable } from './HelpReferenceTable'
import { voiceCategories, type VoiceCategory } from './helpContent'

const steps = [
  { title: 'Alt+Shift+Q 누르기', description: '영상이 멈추고 마이크가 켜져요.' },
  { title: '‘띠’ 소리 뒤에 말하기', description: '다 말하면 ‘말 끝내기’를 누르세요.' },
  { title: '질문·명령 결과 확인', description: '다르면 입력칸을 고쳐 ‘보내기’를 누르세요.' },
]

export function VoiceHelpPanel({ onProblem }: { onProblem: () => void }) {
  const [category, setCategory] = useState<VoiceCategory>('playback')
  const { announce } = useAnnouncer()
  return (
    <div className="space-y-5">
      <section aria-labelledby="help-voice-order">
        <h2 id="help-voice-order" className="sr-only">
          영상을 보면서 말로 요청하는 순서
        </h2>
        <ol className="grid gap-4 lg:grid-cols-3">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className="rounded-md border-2 border-line bg-paper px-5 py-4 text-lg leading-relaxed"
            >
              <h3 className="font-bold">
                {i + 1}. {step.title}
              </h3>
              <p className="mt-3">{step.description}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-lg">
          영상의 ‘질문이나 명령’ 입력칸에 글자를 입력하고 ‘보내기’를 눌러도 돼요.
        </p>
      </section>
      <Tabs
        label="음성 명령 분류"
        appearance="buttons"
        value={category}
        tabListClassName="grid-cols-1 sm:grid-cols-3"
        panelClassName="pt-5"
        onChange={(next) => {
          setCategory(next)
          announce(
            `${voiceCategories.find((item) => item.value === next)?.label} 음성 명령 예시 4개예요.`,
          )
        }}
        items={voiceCategories.map((item) => ({
          value: item.value,
          label: item.label,
          panel: (
            <HelpReferenceTable
              caption={`${item.label} 음성 명령 예시`}
              commandHeading="음성 명령"
              rows={item.rows}
            />
          ),
        }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Button variant="secondary" size="xl" onClick={onProblem}>
          말을 알아듣지 못할 때
        </Button>
        <ButtonLink to="/tutorial/4" size="xl">
          질문하기 사용법 다시 듣기
        </ButtonLink>
      </div>
    </div>
  )
}
