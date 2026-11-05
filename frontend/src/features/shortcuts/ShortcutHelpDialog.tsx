import { Dialog } from '@/components/ui/Dialog'
import { useShortcuts, type ShortcutDef } from './context'
import { shortcutById, shortcutCatalog, spokenCommandOf, type ShortcutEntry } from './catalog'
import './shortcuts.css'

interface Row {
  key: string
  keys: string[]
  description: string
  hint?: string
  spoken: string
  everywhere: boolean
}

/** 등록된 키를 목록 항목 단위로 묶는다 (J·L, 1·2·3 은 한 줄) */
function toRows(list: ShortcutDef[]): Row[] {
  const rows = new Map<string, Row>()
  for (const d of list) {
    const entry: ShortcutEntry | null = d.entryId ? shortcutById(d.entryId) : null
    const key = entry?.id ?? d.combo
    if (rows.has(key)) continue
    rows.set(key, {
      key,
      keys: entry ? entry.keys : [d.combo.replace(/^Alt\+Shift\+/, '')],
      description: d.description,
      hint: d.hint,
      spoken: entry ? spokenCommandOf(entry) : d.combo,
      everywhere: entry ? entry.group === 'everywhere' : d.scope === 'global',
    })
  }
  // 목록(catalog) 순서대로. 목록에 없는 키는 뒤에
  const order = (r: Row) => {
    const i = shortcutCatalog.findIndex((e) => e.id === r.key)
    return i === -1 ? shortcutCatalog.length : i
  }
  return [...rows.values()].sort((a, b) => order(a) - order(b))
}

function RowList({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <ul aria-label={label} className="shortcut-dialog-list">
      {rows.map((r) => (
        <li key={r.key} className="shortcut-dialog-item">
          <span className="shortcut-dialog-keys" aria-hidden="true">
            {r.keys.map((k) => (
              <kbd key={k} className="shortcut-keycap">
                {k}
              </kbd>
            ))}
          </span>
          <span className="sr-only">{r.spoken}</span>
          <span className="min-w-0">
            <span className="shortcut-dialog-desc">{r.description}</span>
            {r.hint && <span className="shortcut-dialog-hint">{r.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 지금 화면에서 쓸 수 있는 단축키 창 (Alt+Shift+/). 이 화면 키를 먼저, 어디서나 쓰는 키를 뒤에 */
export function ShortcutHelpDialog() {
  const { list, helpOpen, setHelpOpen } = useShortcuts()
  const rows = toRows(list)
  const here = rows.filter((r) => !r.everywhere)
  const everywhere = rows.filter((r) => r.everywhere)

  return (
    <Dialog
      open={helpOpen}
      onClose={() => setHelpOpen(false)}
      title="단축키 안내"
      description={`지금 화면에서 쓸 수 있는 단축키 ${rows.length}개예요. 모두 Alt와 Shift를 누른 채로 눌러요. 닫기는 Esc.`}
    >
      <p className="shortcut-dialog-modifier" aria-hidden="true">
        <kbd className="shortcut-keycap shortcut-keycap-sm">Alt</kbd>+
        <kbd className="shortcut-keycap shortcut-keycap-sm">Shift</kbd>를 누른 채로
      </p>
      {here.length > 0 && (
        <section className="shortcut-dialog-section">
          <h3>이 화면에서</h3>
          <RowList rows={here} label="이 화면에서" />
        </section>
      )}
      <section className="shortcut-dialog-section">
        <h3>어디서나</h3>
        <RowList rows={everywhere} label="어디서나" />
      </section>
    </Dialog>
  )
}
