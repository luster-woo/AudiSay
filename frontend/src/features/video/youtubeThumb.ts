/** 유튜브 썸네일 hqdefault(480×360, 위아래 검은 띠 포함) 주소 */
const YOUTUBE_HQ = /^(https:\/\/i\.ytimg\.com\/vi\/[\w-]+\/)hqdefault\.jpg$/

/**
 * 유튜브 썸네일이면 같은 영상의 mqdefault(320×180) 와 hqdefault 를 함께 내놓아, 그리는 크기에 맞는 것을 브라우저가 고르게 한다.
 * 목록에서는 160px 안팎으로 그리는데 480px 짜리를 받고 있었다 (서비스 영상 36개 기준 평균 20.6KB → 12.3KB)
 */
export function youtubeSrcSet(src: string): string | undefined {
  const m = YOUTUBE_HQ.exec(src)
  return m ? `${m[1]}mqdefault.jpg 320w, ${src} 480w` : undefined
}
