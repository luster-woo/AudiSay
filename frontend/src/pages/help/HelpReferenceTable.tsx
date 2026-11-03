import type { HelpRow } from './helpContent'

interface Props {
  caption: string
  commandHeading: string
  rows: HelpRow[]
  keyboard?: boolean
}

export function HelpReferenceTable({ caption, commandHeading, rows, keyboard = false }: Props) {
  return (
    <div className="rounded-md border-2 border-line bg-paper p-3 sm:p-5">
      <table className="w-full table-fixed text-left text-lg leading-relaxed">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-navy text-navy">
            <th scope="col" className="w-1/2 px-3 pb-2">
              {commandHeading}
            </th>
            <th scope="col" className="px-3 pb-2">
              설명
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ command, description }) => (
            <tr key={command} className="border-b border-line last:border-b-0">
              <th scope="row" className="break-words px-3 py-3 align-middle font-bold">
                {keyboard ? <kbd className="break-all font-mono text-lg">{command}</kbd> : command}
              </th>
              <td className="break-words px-3 py-3 align-middle">{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
