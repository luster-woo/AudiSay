import {
  shortcutCatalog,
  shortcutGroups,
  spokenCommandOf,
  type ShortcutEntry,
} from '@/features/shortcuts/catalog'
import { HelpReadableText } from './HelpReadableText'

function ShortcutItem({ entry }: { entry: ShortcutEntry }) {
  return (
    <li className="help-shortcut-item">
      <p className="help-shortcut-keys">
        <HelpReadableText spoken={spokenCommandOf(entry)}>
          <span className="help-shortcut-mod">Alt+Shift+</span>
          <span className="help-shortcut-keyrow">
            {entry.keys.map((key) => (
              <kbd key={key} className="help-keycap help-keycap-lg">
                {key}
              </kbd>
            ))}
          </span>
        </HelpReadableText>
      </p>
      <div className="min-w-0">
        <p className="help-shortcut-desc">
          {entry.spokenDescription ? (
            <HelpReadableText spoken={entry.spokenDescription}>
              {entry.description}
            </HelpReadableText>
          ) : (
            entry.description
          )}
        </p>
        <p className="help-shortcut-hint">{entry.hint}</p>
      </div>
    </li>
  )
}

/** 도움말 '단축키' 탭. 키가 10개 남짓이라 분류 탭 없이 한 화면에 모두 보여 준다 */
export function ShortcutHelpPanel() {
  return (
    <div className="help-reference-panel">
      <div className="help-shortcut-instructions">
        <p className="font-bold">
          <HelpReadableText spoken="모든 단축키는 알트와 시프트를 누른 채로 아래 키를 함께 눌러요.">
            <kbd className="help-keycap">Alt</kbd> + <kbd className="help-keycap">Shift</kbd>를 누른
            채로 아래 키를 함께 눌러요.
          </HelpReadableText>
        </p>
        <p>
          <HelpReadableText spoken="알트와 시프트를 누른 상태에서 슬래시 키를 누르면 지금 화면에서 쓸 수 있는 단축키를 알려 드려요.">
            Alt+Shift+/를 누르면 지금 화면에서 쓸 수 있는 단축키를 알려 드려요.
          </HelpReadableText>
        </p>
      </div>
      {shortcutGroups.map((group) => {
        const entries = shortcutCatalog.filter((entry) => entry.group === group.id)
        const headingId = `help-shortcut-${group.id}`
        return (
          <section key={group.id} aria-labelledby={headingId} className="help-shortcut-group">
            <div className="help-shortcut-group-head">
              <h2 id={headingId}>{group.label}</h2>
              <p>{group.note}</p>
            </div>
            <ul className="help-shortcut-list" aria-labelledby={headingId}>
              {entries.map((entry) => (
                <ShortcutItem key={entry.id} entry={entry} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
