import { Dialog } from '@/components/ui/Dialog'
import { useShortcuts } from './context'

/** 지금 화면에서 쓸 수 있는 단축키 목록 창 */
export function ShortcutHelpDialog() {
  const { list, helpOpen, setHelpOpen } = useShortcuts()

  return (
    <Dialog
      open={helpOpen}
      onClose={() => setHelpOpen(false)}
      title="단축키 안내"
      description={`지금 화면에서 쓸 수 있는 단축키 ${list.length}개예요. 닫기는 Esc.`}
    >
      <dl className="divide-y divide-line">
        {list.map((d) => (
          <div key={d.combo} className="flex items-center justify-between gap-6 py-3">
            <dt className="text-lg">{d.description}</dt>
            <dd>
              <kbd className="kbd">{d.combo}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}