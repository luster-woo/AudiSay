import type { UploadStartBody } from '@/api/types'
import { formatDurationSpoken } from '@/utils/time'

type ContentType = UploadStartBody['contentType']

const BY_EXT: Record<string, ContentType> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}
const ALLOWED = new Set<string>(Object.values(BY_EXT))

/** 브라우저가 type 을 비워 줄 때(일부 MOV)는 확장자로 판단한다 */
export function contentTypeOf(file: File): ContentType | null {
  if (ALLOWED.has(file.type)) return file.type as ContentType
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return BY_EXT[ext] ?? null
}

/** '학습영상_3주차.mp4' → '학습영상_3주차' (제목 기본값) */
export const titleFromFileName = (name: string) => name.replace(/\.[^.]+$/, '').slice(0, 300)

/** 바이트 → '380MB' / '1.2GB' (화면 표시용) */
export function formatSize(bytes: number) {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${Number(gb.toFixed(1))}GB`
  if (bytes === 0) return '0MB'
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))}MB`
}

/** 파일의 영상 길이(초). 읽을 수 없는 파일이면 null */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (sec: number | null) => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      resolve(sec)
    }
    video.preload = 'metadata'
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? Math.round(video.duration) : null)
    video.onerror = () => done(null)
    video.src = url
  })
}

export interface Limits {
  maxDurationSec: number | null
  maxSizeBytes: number | null
}

/** 업로드할 수 없는 이유와 다음 행동. 올릴 수 있으면 null */
export interface Rejection {
  reason: string
  action: string
}

export function checkFile(
  file: File,
  durationSec: number | null,
  limits: Limits,
): Rejection | null {
  if (!contentTypeOf(file)) {
    return { reason: 'MP4, MOV, WebM 파일이 아니에요.', action: '영상 파일을 다시 골라 주세요.' }
  }
  if (limits.maxSizeBytes != null && file.size > limits.maxSizeBytes) {
    return {
      reason: `파일 크기가 ${formatSize(limits.maxSizeBytes)}를 넘었어요.`,
      action: '해상도를 낮춰 저장한 뒤 다시 골라 주세요.',
    }
  }
  if (durationSec == null) {
    return { reason: '영상 파일을 읽을 수 없어요.', action: '다른 파일을 골라 주세요.' }
  }
  if (limits.maxDurationSec != null && durationSec > limits.maxDurationSec) {
    return {
      reason: `영상이 ${formatDurationSpoken(limits.maxDurationSec)}을 넘어요.`,
      action: '앞뒤를 잘라 저장한 뒤 다시 골라 주세요.',
    }
  }
  return null
}
