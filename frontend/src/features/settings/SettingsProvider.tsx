import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import { toUserMessage } from '@/api/errors'
import { DEFAULT_SETTINGS, type UserSettings } from '@/api/types'
import { useAuth } from '@/features/auth/context'
import { useAnnouncer } from '@/features/announcer/context'
import { SettingsContext, type SettingsValue } from './context'

/* CSS 가 읽는 html 속성 */
function applyToDocument(s: Pick<UserSettings, 'highContrast' | 'fontSizeLevel'>) {
  const root = document.documentElement
  root.dataset.fontScale = String(s.fontSizeLevel)
  root.dataset.contrast = s.highContrast ? 'high' : 'normal'
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { status, isAdmin } = useAuth()
  const { announce } = useAnnouncer()
  const queryClient = useQueryClient()
  const enabled = status === 'authenticated'

  const query = useQuery({
    queryKey: queryKeys.settings,
    queryFn: usersApi.settings,
    enabled,
  })

  const settings = query.data ?? DEFAULT_SETTINGS
  const { highContrast, fontSizeLevel } = settings

  useEffect(() => {
    applyToDocument(
      isAdmin ? { highContrast: false, fontSizeLevel: 2 } : { highContrast, fontSizeLevel },
    )
  }, [isAdmin, highContrast, fontSizeLevel])

  const mutation = useMutation({
    mutationFn: usersApi.updateSettings,
    // 낙관적 업데이트: 서버 응답 전에 화면·html 속성을 먼저 바꾼다
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings })
      const prev = queryClient.getQueryData<UserSettings>(queryKeys.settings)
      queryClient.setQueryData<UserSettings>(queryKeys.settings, (old) => ({
        ...(old ?? DEFAULT_SETTINGS),
        ...patch,
      }))
      return { prev }
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.settings, ctx.prev)
      announce(toUserMessage(err), { politeness: 'assertive' })
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data)
    },
  })

  const update = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!enabled) {
        // 비로그인(랜딩·튜토리얼 전) 에서는 로컬에만 반영
        queryClient.setQueryData<UserSettings>(queryKeys.settings, (old) => ({
          ...(old ?? DEFAULT_SETTINGS),
          ...patch,
        }))
        return
      }
      await mutation.mutateAsync(patch)
    },
    [enabled, mutation, queryClient],
  )

  const value = useMemo<SettingsValue>(
    () => ({ settings, isLoaded: !enabled || query.isSuccess, update }),
    [settings, enabled, query.isSuccess, update],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
