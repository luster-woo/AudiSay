import type { HelpRow } from './helpContent'
import { HelpReadableText } from './HelpReadableText'

interface Props {
  caption: string
  commandHeading: string
  rows: HelpRow[]
  keyboard?: boolean
}

export function HelpReferenceTable({ caption, commandHeading, rows, keyboard = false }: Props) {
  return (
    <div className={`help-reference-table${rows.length === 5 ? ' help-reference-table-five' : ''}`}>
      <table className="w-full table-fixed text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-1/2">
              {commandHeading}
            </th>
            <th scope="col">설명</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ command, description, spokenCommand, spokenDescription }) => (
            <tr key={command}>
              <th scope="row" className="break-words font-bold">
                {keyboard ? (
                  <kbd className="break-all font-sans">
                    <HelpReadableText spoken={spokenCommand}>{command}</HelpReadableText>
                  </kbd>
                ) : (
                  <HelpReadableText spoken={spokenCommand}>{command}</HelpReadableText>
                )}
              </th>
              <td className="break-words">
                {spokenDescription ? (
                  <HelpReadableText spoken={spokenDescription}>{description}</HelpReadableText>
                ) : (
                  description
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
