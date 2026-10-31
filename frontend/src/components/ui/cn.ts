/** 조건부 className 합치기: cn('a', on && 'b', undefined) → 'a b' */
export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}