import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import { toUserMessage } from '@/api/errors'
import { DEFAULT_SETTINGS, type UserSettings } from '@/api/types'
import { useAuth } from '@/features/auth/context'
import { useAnnouncer } from '@/features/announcer/context'
import { SettingsContext, type SettingsValue } from './context'
import { readDisplay, saveDisplay } from './displayCache'

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

  // 설정을 아직 받지 못했으면(세션 확인 중·응답 대기·비로그인) 기본값이 아니라 이 브라우저에 기억해 둔 값을 쓴다.
  // index.html 이 그 값을 그리기 전에 이미 칠해 두었다 — 기본값으로 덮으면 화면이 줄었다 다시 커지며 밀린다
  const loaded = query.data !== undefined
  useEffect(() => {
    if (isAdmin) {
      // 관리자 화면은 고정 크기·일반 대비(원칙 12장). 사용자 화면용 기억에는 남기지 않는다
      applyToDocument({ highContrast: false, fontSizeLevel: 2 })
      return
    }
    if (!loaded) {
      // 관리자가 로그아웃한 경우처럼 고정 크기가 남아 있으면 되돌린다. 처음 그린 값과 같으면 화면은 그대로다
      applyToDocument(readDisplay() ?? DEFAULT_SETTINGS)
      return
    }
    applyToDocument({ highContrast, fontSizeLevel })
    saveDisplay({ highContrast, fontSizeLevel })
  }, [isAdmin, loaded, highContrast, fontSizeLevel])

  const mutation = useMutation({
    mutationFn: (patch: Partial<UserSettings>) => usersApi.updateSettings(patch),
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
