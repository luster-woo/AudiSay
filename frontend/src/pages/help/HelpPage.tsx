import { useRef, useState } from 'react'
import { Tabs } from '@/components/ui/Tabs'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { GettingStartedPanel } from './GettingStartedPanel'
import { ShortcutHelpPanel } from './ShortcutHelpPanel'
import { VoiceHelpPanel } from './VoiceHelpPanel'
import { HelpTroubleshootingDialog, type HelpProblem } from './HelpTroubleshootingDialog'

type HelpTab = 'start' | 'shortcuts' | 'voice'
const sections: Record<HelpTab, { label: string; description: string }> = {
  start: {
    label: '처음이라면',
    description: '사용법을 듣고, 키보드와 음성으로 조작하는 방법을 확인해요.',
  },
  shortcuts: { label: '단축키', description: '키보드로 화면을 이동하고 영상을 조작할 수 있어요.' },
  voice: {
    label: '말로 하는 명령',
    description: '영상을 보면서 궁금한 점을 묻거나 재생과 이동을 말로 요청할 수 있어요.',
  },
}

export default function HelpPage() {
  const [tab, setTab] = useState<HelpTab>('start')
  const [problem, setProblem] = useState<HelpProblem | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { announce } = useAnnouncer()
  usePageEntry({
    title: '도움말',
    announce: '도움말이에요. 처음이라면, 단축키, 말로 하는 명령 중에서 골라 주세요.',
    focusRef: headingRef,
  })
  return (
    <div className="min-w-0 max-sm:-mx-10">
      <h1 ref={headingRef} tabIndex={-1} className="text-4xl font-bold outline-none">
        도움말
      </h1>
      <p className="mt-3 mb-5 text-lg leading-relaxed">{sections[tab].description}</p>
      <Tabs<HelpTab>
        label="도움말 종류"
        variant="pills"
        value={tab}
        tabListClassName="gap-3"
        panelClassName="pt-6"
        onChange={(next) => {
          setTab(next)
          announce(`${sections[next].label} 도움말이에요. ${sections[next].description}`)
        }}
        items={[
          { value: 'start', label: sections.start.label, panel: <GettingStartedPanel /> },
          {
            value: 'shortcuts',
            label: sections.shortcuts.label,
            panel: <ShortcutHelpPanel onProblem={() => setProblem('shortcut')} />,
          },
          {
            value: 'voice',
            label: sections.voice.label,
            panel: <VoiceHelpPanel onProblem={() => setProblem('voice')} />,
          },
        ]}
      />
      <HelpTroubleshootingDialog problem={problem} onClose={() => setProblem(null)} />
    </div>
  )
}
