import { useRef, useState } from 'react'
import { Tabs } from '@/components/ui/Tabs'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'
import { ShortcutHelpPanel } from './ShortcutHelpPanel'
import { VoiceHelpPanel } from './VoiceHelpPanel'
import '@fontsource/ibm-plex-sans-kr/400.css'
import '@fontsource/ibm-plex-sans-kr/700.css'
import './help.css'

type HelpTab = 'shortcuts' | 'voice'
const sections: Record<HelpTab, { label: string; description: string }> = {
  shortcuts: { label: '단축키', description: '키보드로 화면을 이동하고 영상을 조작할 수 있어요.' },
  voice: {
    label: '말로 하는 명령',
    description: '궁금한 점을 묻거나, 영상 재생과 화면 이동을 말로 요청할 수 있어요.',
  },
}

export default function HelpPage() {
  const [tab, setTab] = useState<HelpTab>('shortcuts')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { announce } = useAnnouncer()
  usePageEntry({
    title: '도움말',
    announce:
      '도움말, 단축키 탭이에요. 단축키와 말로 하는 명령을 확인하거나 튜토리얼로 이동할 수 있어요.',
    focusRef: headingRef,
  })
  return (
    <div className="help-page min-w-0">
      <div className="help-wireframe-view">
        <h1 ref={headingRef} tabIndex={-1} className="help-title font-bold outline-none">
          도움말
        </h1>
        <p className="help-description">{sections[tab].description}</p>
        <Tabs<HelpTab>
          label="도움말 종류"
          variant="pills"
          value={tab}
          className="help-primary-tabs"
          panelClassName="help-primary-panel"
          navigationEnd={
            <ButtonLink to="/tutorial/1" size="xl" className="help-tutorial-link">
              튜토리얼 이동
            </ButtonLink>
          }
          onChange={(next) => {
            setTab(next)
            announce(`${sections[next].label} 도움말이에요. ${sections[next].description}`)
          }}
          items={[
            {
              value: 'shortcuts',
              label: sections.shortcuts.label,
              panel: <ShortcutHelpPanel />,
            },
            {
              value: 'voice',
              label: sections.voice.label,
              panel: <VoiceHelpPanel />,
            },
          ]}
        />
      </div>
    </div>
  )
}
