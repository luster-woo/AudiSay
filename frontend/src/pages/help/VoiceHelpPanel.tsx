import { useState } from 'react'
import { Tabs } from '@/components/ui/Tabs'
import { useAnnouncer } from '@/features/announcer/context'
import { HelpReferenceTable } from './HelpReferenceTable'
import { HelpReadableText } from './HelpReadableText'
import { voiceCategories, type VoiceCategory } from './helpContent'

const steps = [
  {
    title: 'Alt+Shift+V 누르기',
    description: '음성 입력을 시작해요.',
    spokenTitle: '일 단계. 알트와 시프트를 누른 상태에서 브이 키를 누르세요.',
    spokenDescription: '음성 입력을 시작해요.',
  },
  {
    title: '‘띵’ 소리 뒤에 말하기',
    description: '원하는 요청을 말해 주세요.',
    spokenTitle: '이 단계. 띵 소리가 나면 말하세요.',
    spokenDescription: '원하는 요청을 말해 주세요.',
  },
  {
    title: '들은 내용 확인',
    description: '내용이 틀리면 ‘아니’라고 말해 주세요.',
    spokenTitle: '삼 단계. 들은 내용을 확인하세요.',
    spokenDescription: '내용이 틀리면 아니라고 말해 주세요.',
  },
]

export function VoiceHelpPanel() {
  const [category, setCategory] = useState<VoiceCategory>('playback')
  const { announce } = useAnnouncer()
  return (
    <div className="help-reference-panel">
      <section aria-labelledby="help-voice-order">
        <h2 id="help-voice-order" className="sr-only">
          영상을 보면서 말로 요청하는 순서
        </h2>
        <ol className="help-voice-steps">
          {steps.map((step, i) => (
            <li key={step.title} className="help-voice-step">
              <h3 className="font-bold">
                <HelpReadableText spoken={step.spokenTitle}>
                  {['①', '②', '③'][i]} {step.title}
                </HelpReadableText>
              </h3>
              <p>
                <HelpReadableText spoken={step.spokenDescription}>
                  {step.description}
                </HelpReadableText>
              </p>
              {i < steps.length - 1 && (
                <span className="help-step-arrow" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
      <Tabs
        label="음성 명령 분류"
        appearance="buttons"
        className="help-category-tabs"
        value={category}
        tabListClassName="grid-cols-1 sm:grid-cols-4"
        panelClassName="help-category-panel"
        onChange={(next) => {
          setCategory(next)
          announce(
            (() => {
              const picked = voiceCategories.find((item) => item.value === next)
              return `${picked?.label} 음성 명령 예시 ${picked?.rows.length ?? 0}개예요.`
            })(),
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
    </div>
  )
}
