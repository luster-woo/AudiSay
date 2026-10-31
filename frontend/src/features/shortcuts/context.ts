import { createContext, useContext, useEffect, useRef } from 'react'

export type ShortcutScope = 'global' | 'user' | 'watch' | 'admin'

export interface ShortcutDef {
  /** 'Alt+Shift+R' 형태. 키는 대문자, 수식키 순서는 Alt, Shift, Ctrl */
  combo: string
  description: string
  scope: ShortcutScope
  handler: (e: KeyboardEvent) => void
  /** true 면 입력창에 포커스가 있어도 동작 (기본: Alt+Shift 조합만 허용) */
  allowInInput?: boolean
}

export interface ShortcutValue {
  register: (def: ShortcutDef) => () => void
  /** 현재 레이아웃이 활성화한 scope */
  setActiveScope: (scope: Exclude<ShortcutScope, 'global'> | null) => void
  list: ShortcutDef[]
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
}

export const ShortcutContext = createContext<ShortcutValue | null>(null)

export function useShortcuts() {
  const ctx = useContext(ShortcutContext)
  if (!ctx) throw new Error('useShortcuts 는 ShortcutProvider 안에서만 쓸 수 있어요')
  return ctx
}

/** 컴포넌트에서 단축키 하나를 등록. 언마운트되면 자동 해제 */
export function useShortcut(
  combo: string,
  handler: ShortcutDef['handler'],
  opts: { description: string; scope?: ShortcutScope; allowInInput?: boolean },
) {
  const { register } = useShortcuts()
  const handlerRef = useRef(handler)
  // 렌더 중 ref 를 쓰지 않도록 effect 에서 handler를 최신으로 저장
  useEffect(() => {
    handlerRef.current = handler
  })
  useEffect(
    () =>
      register({
        combo,
        description: opts.description,
        scope: opts.scope ?? 'global',
        allowInInput: opts.allowInInput,
        handler: (e) => handlerRef.current(e),
      }),
    [combo, opts.description, opts.scope, opts.allowInInput, register],
  )
}

export function useShortcutScope(scope: Exclude<ShortcutScope, 'global'>) {
  const { setActiveScope } = useShortcuts()
  useEffect(() => {
    setActiveScope(scope)
    return () => setActiveScope(null)
  }, [scope, setActiveScope])
}
