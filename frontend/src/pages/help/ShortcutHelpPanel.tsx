import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { Tabs } from '@/components/ui/Tabs'
import { useAnnouncer } from '@/features/announcer/context'
import { useShortcuts } from '@/features/shortcuts/context'
import { HelpReferenceTable } from './HelpReferenceTable'
import { shortcutCategories, type ShortcutCategory } from './helpContent'

export function ShortcutHelpPanel({ onProblem }: { onProblem: () => void }) {
  const [category, setCategory] = useState<ShortcutCategory>('everywhere')
  const { announce } = useAnnouncer()
  const { list } = useShortcuts()
  const globalRows = list
    .filter((item) => item.scope === 'global' || item.scope === 'user')
    .map((item) => ({ command: item.combo, description: item.description }))
  return (
    <div className="space-y-5">
      <div className="rounded-md border-2 border-line bg-paper px-5 py-4 text-lg leading-relaxed">
        <p className="font-bold">Alt+Shift+/를 누르면 현재 화면의 단축키를 확인할 수 있어요.</p>
        <p>키를 함께 누르세요. 예: Alt+Shift+H. 탭 사이는 왼쪽·오른쪽 화살표로 이동해요.</p>
      </div>
      <Tabs
        label="단축키 분류"
        appearance="buttons"
        value={category}
        tabListClassName="grid-cols-1 sm:grid-cols-3"
        panelClassName="pt-5"
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
            <>
              {item.value !== 'everywhere' && (
                <p className="mb-3 text-lg">
                  영상을 보는 화면에서 사용해요. 키마다 사용할 위치를 확인해 주세요.
                </p>
              )}
              <HelpReferenceTable
                caption={`${item.label} 단축키`}
                commandHeading="단축키"
                rows={item.value === 'everywhere' ? globalRows : item.rows}
                keyboard
              />
            </>
          ),
        }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Button variant="secondary" size="xl" onClick={onProblem}>
          단축키가 작동하지 않을 때
        </Button>
        <ButtonLink to="/tutorial/1" size="xl">
          사용법 다시 듣기
        </ButtonLink>
      </div>
    </div>
  )
}
