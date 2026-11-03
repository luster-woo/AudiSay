import { useState } from 'react'
import { Tabs } from '@/components/ui/Tabs'
import { useAnnouncer } from '@/features/announcer/context'
import { HelpReferenceTable } from './HelpReferenceTable'
import { HelpReadableText } from './HelpReadableText'
import { shortcutCategories, type ShortcutCategory } from './helpContent'

export function ShortcutHelpPanel() {
  const [category, setCategory] = useState<ShortcutCategory>('everywhere')
  const { announce } = useAnnouncer()
  return (
    <div className="help-reference-panel">
      <div className="help-shortcut-instructions">
        <p className="font-bold">
          <HelpReadableText spoken="알트와 시프트를 누른 상태에서 슬래시 키를 누르면 현재 화면의 단축키를 읽어 드려요.">
            Alt+Shift+/를 누르면 현재 화면의 단축키를 읽어 드려요.
          </HelpReadableText>
        </p>
        <p>
          <HelpReadableText spoken="키를 함께 누르세요. 예를 들어 알트와 시프트를 누른 상태에서 에이치 키를 누르세요.">
            키를 함께 누르세요. 예: Alt+Shift+H
          </HelpReadableText>
        </p>
      </div>
      <Tabs
        label="단축키 분류"
        appearance="buttons"
        value={category}
        className="help-category-tabs"
        tabListClassName="grid-cols-1 sm:grid-cols-3"
        panelClassName="help-category-panel"
        onChange={(next) => {
          setCategory(next)
          announce(
            `${shortcutCategories.find((item) => item.value === next)?.label} 단축키예요.${next === 'everywhere' ? '' : ' 영상을 보는 화면에서 사용해요.'}`,
          )
        }}
        items={shortcutCategories.map((item) => ({
          value: item.value,
          label: item.label,
          panel: (
            <HelpReferenceTable
              caption={`${item.label} 단축키`}
              commandHeading="단축키"
              rows={item.rows}
              keyboard
            />
          ),
        }))}
      />
    </div>
  )
}
