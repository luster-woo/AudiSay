/**
 * 탭 사이에서 '이 업로드는 지금 올리는 중'을 알리는 잠금 (Web Locks API).
 * 올리는 탭이 잠금을 쥐고 있고, 탭이 닫히면 브라우저가 저절로 푼다.
 * 다른 탭은 잠금이 풀린(= 정말 버려진) 업로드만 정리한다. 안 그러면 탭 B 가 탭 A 의 올리는 중인 업로드를 지운다
 */
const lockName = (videoId: number) => `audisay:upload:${videoId}`

function locks(): LockManager | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null
}

/** 이 탭이 업로드를 쥔다. 잠금을 받은 뒤에 돌아오고, 돌려준 함수를 부르면 푼다 */
export async function holdUploadLock(videoId: number): Promise<() => void> {
  const lm = locks()
  if (!lm) return () => {}
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await new Promise<void>((granted) => {
    lm.request(lockName(videoId), () => {
      granted()
      return held
    }).catch(() => granted())
  })
  return release
}

/**
 * 다른 탭이 이 업로드를 올리는 중인가.
 * 잠금을 쓸 수 없는 브라우저면 알 수 없으므로 '그렇다'로 보고 지우지 않는다 (서버가 오래된 업로드를 따로 정리한다)
 */
export async function uploadActiveElsewhere(videoId: number): Promise<boolean> {
  const lm = locks()
  if (!lm) return true
  try {
    return await lm.request(lockName(videoId), { ifAvailable: true }, (lock) => lock === null)
  } catch {
    return true
  }
}
