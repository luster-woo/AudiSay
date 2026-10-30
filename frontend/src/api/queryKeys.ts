export const queryKeys = {
  me: ['me'] as const,
  settings: ['me', 'settings'] as const,
  videos: (params: Record<string, unknown>) => ['videos', params] as const,
  video: (id: number) => ['videos', id] as const,
  job: (id: number) => ['jobs', id] as const,
  admin: {
    all: ['admin'] as const,
    reports: (params: Record<string, unknown>) => ['admin', 'reports', params] as const,
    users: (params: Record<string, unknown>) => ['admin', 'users', params] as const,
  },
}