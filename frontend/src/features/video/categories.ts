import type { VideoCategory } from '@/api/types'

export const CATEGORY_LABELS: Record<VideoCategory, string> = {
  EDUCATION: '교육',
  COOKING: '요리·음식',
  GAME: '게임',
  MUSIC: '음악',
  SCIENCE_IT: '과학·IT',
  NEWS: '뉴스',
  ENTERTAINMENT: '엔터테인먼트',
  SPORTS: '스포츠',
  ETC: '기타',
}

/** 카테고리 select 선택지. 값 '' 은 전체 */
export const CATEGORY_OPTIONS = [
  { value: '', label: '전체' },
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
]
