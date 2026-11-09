import { useCallback } from 'react'
import { useAuth } from '@/features/auth/context'
import { useSettings } from '@/features/settings/context'

/** 사용법을 마치거나 건너뛰면 완료로 저장한다 (다음 로그인부터 사용법이 나오지 않음) */
export function useFinishTutorial() {
  const { update } = useSettings()
  const { updateUser } = useAuth()
  return useCallback(async () => {
    try {
      await update({ tutorialCompleted: true })
    } catch {
      // 저장 실패는 SettingsProvider 가 이미 알렸다. 사용법은 다음 로그인 때 다시 나온다
    }
    updateUser({ tutorialCompleted: true })
  }, [update, updateUser])
}
