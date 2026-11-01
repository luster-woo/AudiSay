/** 유튜브 주소(watch, youtu.be, shorts, embed)인지. 검색어와 주소를 나누는 데 쓴다 */
const YOUTUBE_URL =
  /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?(.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)[\w-]{11}/i

export function isYoutubeUrl(text: string) {
  return YOUTUBE_URL.test(text.trim())
}

/** 영상 ID → 짧은 주소 (사전 확인 화면으로 넘길 때) */
export const youtubeShortUrl = (youtubeVideoId: string) => `https://youtu.be/${youtubeVideoId}`
