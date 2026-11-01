import { useEffect } from 'react'
import { StatusLine } from '@/components/ui/StatusLine'

/**
 * 1단계 연습: Alt+Shift+R 누르기.
 * 다시 듣기 자체는 전역 단축키가 처리하고, 여기서는 눌렀는지만 지켜본다 (기본 동작을 막지 않음).
 */
export function RepeatPractice({ done, onDone }: { done: boolean; onDone: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyR') onDone()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onDone])

  return <StatusLine done={done} text={done ? 'Alt+Shift+R을 눌렀어요' : '아직 누르지 않았어요'} />
}
