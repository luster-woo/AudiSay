import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ShortcutContext,
  type ShortcutDef,
  type ShortcutScope,
  type ShortcutValue,
} from './context'

function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key // 'r' → 'R', 'ArrowLeft' 그대로
  parts.push(key === '?' ? '/' : key) // Shift+/ 는 브라우저가 '?' 로 준다
  return parts.join('+')
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
  // 등록된 단축키 전체. state 로 두어 list 가 렌더에서 안전하게 파생된다
  const [defs, setDefs] = useState<ShortcutDef[]>([])
  const [activeScope, setActiveScope] = useState<Exclude<ShortcutScope, 'global'> | null>(null)

  const register = useCallback((def: ShortcutDef) => {
    setDefs((prev) => [...prev, def])
    return () => setDefs((prev) => prev.filter((d) => d !== def))
  }, [])

  /** 활성 scope 에 해당하는 단축키만 */
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
