import { createContext, useContext, useEffect, useRef } from 'react'
import { comboOf, shortcutById, type ShortcutEntryId } from './catalog'

export type ShortcutScope = 'global' | 'user' | 'watch' | 'admin'

export interface ShortcutDef {
  /** 'Alt+Shift+R' 형태. 키는 대문자, 수식키 순서는 Alt, Shift, Ctrl */
  combo: string
  description: string
  scope: ShortcutScope
  handler: (e: KeyboardEvent) => void
  /** true 면 입력창에 포커스가 있어도 동작 (기본: Alt+Shift 조합만 허용) */
  allowInInput?: boolean
  /** true 면 대화상자(모달)가 열려 있어도 동작. 기본은 뒤 화면을 조작하지 않도록 막는다 */
  allowInDialog?: boolean
  /** 단축키 목록(catalog)의 항목. 안내 창이 키캡·분류를 이것으로 그린다 */
  entryId?: ShortcutEntryId
  /** 이 화면에서 쓰는 기억법 (없으면 목록의 것) */
  hint?: string
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

/**
 * 단축키 목록(catalog.ts)의 항목 하나를 이 화면에 등록한다.
 * J/L, 1/2/3 처럼 키가 여러 개면 모두 등록하고, 누른 키를 handler 에 넘긴다.
 * 안내 창(Alt+Shift+/)은 지금 등록된 항목만 보여 주므로, 화면마다 실제로 쓰는 키만 나온다.
 */
export function useShortcutEntry(
  id: ShortcutEntryId,
  handler: (key: string, e: KeyboardEvent) => void,
  opts: {
    scope?: ShortcutScope
    /** 같은 키를 화면마다 다르게 쓸 때 (예: 홈의 Q 는 '음성으로 찾기') */
    description?: string
    hint?: string
    allowInDialog?: boolean
    /** false 면 등록하지 않는다 */
    enabled?: boolean
  } = {},
) {
  const { register } = useShortcuts()
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })
  const { scope = 'global', description, hint, allowInDialog, enabled = true } = opts
  useEffect(() => {
    if (!enabled) return
    const entry = shortcutById(id)
    const offs = entry.keys.map((key) =>
      register({
        combo: comboOf(key),
        description: description ?? entry.description,
        hint: hint ?? (description ? undefined : entry.hint),
        scope,
        allowInInput: true,
        allowInDialog,
        entryId: id,
        handler: (e) => handlerRef.current(key, e),
      }),
    )
    return () => offs.forEach((off) => off())
  }, [id, scope, description, hint, allowInDialog, enabled, register])
}
