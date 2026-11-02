export const queryKeys = {
  me: ['me'] as const,
  settings: ['me', 'settings'] as const,
  quota: ['me', 'quota'] as const,
  myVideos: (page: number) => ['me', 'videos', page] as const,
  videos: (params: Record<string, unknown>) => ['videos', params] as const,
  video: (id: number) => ['videos', id] as const,
  youtubeSearch: (q: string) => ['youtube', 'search', q] as const,
  youtubeCheck: (url: string) => ['youtube', 'check', url] as const,
  job: (id: number) => ['jobs', id] as const,
  admin: {
    all: ['admin'] as const,
    reports: (params: Record<string, unknown>) => ['admin', 'reports', params] as const,
    users: (params: Record<string, unknown>) => ['admin', 'users', params] as const,
  },
}
