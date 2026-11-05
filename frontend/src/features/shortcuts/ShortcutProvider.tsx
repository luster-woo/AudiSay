import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ShortcutContext,
  type ShortcutDef,
  type ShortcutScope,
  type ShortcutValue,
} from './context'

function keyName(e: KeyboardEvent): string {
  const { code } = e
  if (code.startsWith('Key')) return code.slice(3) // 'KeyR' → 'R'
  if (code.startsWith('Digit')) return code.slice(5) // 'Digit1' → '1'
  if (code === 'Slash') return '/'
  if (code === 'Space') return 'Space'
  return e.key // 'ArrowLeft', 'Escape', 'PageUp', 'Home' 등은 e.key 그대로
}

function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  parts.push(keyName(e))
  return parts.join('+')
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [defs, setDefs] = useState<ShortcutDef[]>([])
  const [activeScope, setActiveScope] = useState<Exclude<ShortcutScope, 'global'> | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const register = useCallback((def: ShortcutDef) => {
    setDefs((prev) => [...prev, def])
    return () => setDefs((prev) => prev.filter((d) => d !== def))
  }, [])

  const list = useMemo(
    () => defs.filter((d) => d.scope === 'global' || d.scope === activeScope),
    [defs, activeScope],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e)
      const candidates = list.filter((d) => d.combo === combo)
      if (candidates.length === 0) return
      const typing = isTypingTarget(e.target)
      // 대화상자가 열려 있으면 뒤 화면을 조작하지 않는다 (다시 듣기처럼 허용한 키만)
      const modalOpen = document.querySelector('dialog[open]') !== null
      const def = candidates.find(
        (d) =>
          (!modalOpen || d.allowInDialog) &&
          (!typing || d.allowInInput || (e.altKey && e.shiftKey)),
      )
      if (!def) return
      e.preventDefault()
      def.handler(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [list])

  const value = useMemo<ShortcutValue>(
    () => ({ register, setActiveScope, list, helpOpen, setHelpOpen }),
    [register, list, helpOpen],
  )

  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>
}
