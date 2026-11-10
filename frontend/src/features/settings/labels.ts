import type { UserSettings } from '@/api/types'

/**
 * 재생 설정의 이름과 값 이름. 재생 설정 창·상세도 버튼·챗봇 답이 모두 이것을 쓴다 (재생 설정 창 이름 기준, 2026-11-10 점검).
 * 챗봇이 '재생 전 요약 물어보기로 바꿨어요'라고 하면 설정 창의 '보기 전 30초 요약 · 묻기'와 같은 항목인지 알기 어려웠다
 */
export const DETAIL_LABELS: { value: UserSettings['detailLevel']; label: string }[] = [
  { value: 1, label: '1 짧은 해설' },
  { value: 2, label: '2 기본 해설' },
  { value: 3, label: '3 자세한 해설' },
]
export const MODE_LABELS: { value: UserSettings['narrationMode']; label: string }[] = [
  { value: 'AUTO', label: '자동' },
  { value: 'WITH_VIDEO', label: '영상과 함께' },
  { value: 'PAUSE_AFTER', label: '멈추고' },
]
export const MIX_LABELS: { value: UserSettings['soundMix']; label: string }[] = [
  { value: 'DIALOGUE_AND_NARRATION', label: '대사 + 해설' },
  { value: 'DIALOGUE_ONLY', label: '대사만' },
]
export const SUBTITLE_LABELS: { value: UserSettings['subtitleReading']; label: string }[] = [
  { value: 'ALL', label: '모두' },
  { value: 'DIFFERENT_ONLY', label: '다른 것만' },
  { value: 'OFF', label: '끄기' },
]
export const SEEK_LABELS: { value: UserSettings['seekStepSec']; label: string }[] = [
  { value: 5, label: '5초' },
  { value: 10, label: '10초' },
  { value: 30, label: '30초' },
]
export const SUMMARY_LABELS: { value: UserSettings['summaryMode']; label: string }[] = [
  { value: 'ASK', label: '묻기' },
  { value: 'ALWAYS', label: '항상' },
  { value: 'NEVER', label: '안 듣기' },
]

/** 설정 이름 (재생 설정 창의 묶음·칸 이름) */
export const SETTING_NAMES: Partial<Record<keyof UserSettings, string>> = {
  detailLevel: '해설 상세도',
  speechRate: '말하기 속도',
  originalVolume: '영상 소리 크기',
  seekStepSec: '앞뒤 이동 간격',
  fontSizeLevel: '글자 크기',
  highContrast: '고대비 화면',
  narrationMode: '해설 방식',
  soundMix: '들을 소리',
  subtitleReading: '자막 읽기',
  summaryMode: '보기 전 30초 요약',
}

/** 글자 값(AUTO 등) → 값 이름. 값은 설정마다 겹치지 않는다 */
export const VALUE_NAMES: Record<string, string> = Object.fromEntries(
  [...MODE_LABELS, ...MIX_LABELS, ...SUBTITLE_LABELS, ...SUMMARY_LABELS].map((o) => [
    o.value,
    o.label,
  ]),
)
