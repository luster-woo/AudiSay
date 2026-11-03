import type { YoutubeRejectReason } from '@/api/types'

/** 유튜브 사전 확인(POST /videos/youtube/check)의 rejectReason → 화면·낭독 문구 */
export function rejectText(reason: YoutubeRejectReason | null, maxMin: number | null) {
  switch (reason) {
    case 'NOT_FOUND':
      return { short: '영상을 찾을 수 없어요.', detail: '주소가 맞는지 다시 확인해 주세요.' }
    case 'PRIVATE':
      return { short: '비공개이거나 삭제된 영상이에요.', detail: '비공개이거나 삭제된 영상이에요.' }
    case 'NOT_EMBEDDABLE':
      return {
        short: '다른 사이트에서 재생을 막은 영상이에요.',
        detail: '다른 사이트에서 재생할 수 없도록 설정된 영상이에요.',
      }
    case 'TOO_LONG':
      return {
        short: '영상이 너무 길어요.',
        detail: `지금 등급은 ${maxMin ?? ''}분 이하 영상만 해설을 만들 수 있어요.`,
      }
    case 'AGE_RESTRICTED':
      return { short: '연령 제한 영상이에요.', detail: '연령 제한이 있는 영상은 지원하지 않아요.' }
    case 'LIVE':
      return { short: '실시간 방송이에요.', detail: '실시간 방송은 지원하지 않아요.' }
    default:
      return { short: '해설을 만들 수 없는 영상이에요.', detail: '해설을 만들 수 없는 영상이에요.' }
  }
}
