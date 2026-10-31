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
      const def = candidates.find((d) => !typing || d.allowInInput || (e.altKey && e.shiftKey))
      if (!def) return
      e.preventDefault()
      def.handler(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [list])

  const value = useMemo<ShortcutValue>(() => ({ register, setActiveScope, list }), [register, list])

  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>
}
