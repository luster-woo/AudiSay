import { uploadsApi } from '@/api/uploads'

/** 네트워크가 끊겨 조각을 못 올렸을 때 */
export class UploadNetworkError extends Error {
  constructor() {
    super('연결이 끊겨 업로드가 멈췄어요.')
    this.name = 'UploadNetworkError'
  }
}

interface Options {
  videoId: number
  file: File
  partSizeBytes: number
  partCount: number
  /** 지금까지 올린 바이트 */
  onProgress: (loadedBytes: number) => void
  signal: AbortSignal
}

const URL_BATCH = 20 // 명세: 한 번에 최대 20개 주소 발급
const PARALLEL = 3 // 동시에 올릴 조각 수

/** 조각 하나를 S3 에 PUT. 진행률을 받으려고 fetch 대신 XHR 을 쓴다 */
function putPart(url: string, blob: Blob, signal: AbortSignal, onLoaded: (n: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.upload.onprogress = (e) => onLoaded(e.loaded)
    xhr.onload = () => {
      // S3 버킷 CORS 에서 ETag 를 노출해야 읽을 수 있다 (명세)
      const eTag = xhr.getResponseHeader('ETag')
      if (xhr.status >= 200 && xhr.status < 300 && eTag) resolve(eTag)
      else reject(new UploadNetworkError())
    }
    xhr.onerror = () => reject(new UploadNetworkError())
    xhr.ontimeout = () => reject(new UploadNetworkError())
    const abort = () => {
      xhr.abort()
      reject(new DOMException('aborted', 'AbortError'))
    }
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    xhr.send(blob)
  })
}

/**
 * 파일을 조각내 올리고 완료용 [partNumber, eTag] 목록을 돌려준다.
 * 조각 주소는 20개씩 받아 오고, 조각은 3개씩 동시에 올린다.
 */
export async function uploadParts({
  videoId,
  file,
  partSizeBytes,
  partCount,
  onProgress,
  signal,
}: Options) {
  const loaded = new Array<number>(partCount).fill(0)
  const report = () => onProgress(loaded.reduce((a, b) => a + b, 0))
  const done: { partNumber: number; eTag: string }[] = []

  for (let first = 1; first <= partCount; first += URL_BATCH) {
    const numbers = Array.from(
      { length: Math.min(URL_BATCH, partCount - first + 1) },
      (_, i) => first + i,
    )
    const { parts } = await uploadsApi.partUrls(videoId, numbers)
    const queue = [...parts]

    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const start = (p.partNumber - 1) * partSizeBytes
        const blob = file.slice(start, Math.min(start + partSizeBytes, file.size))
        const index = p.partNumber - 1
        const eTag = await putPart(p.url, blob, signal, (n) => {
          loaded[index] = n
          report()
        })
        loaded[index] = blob.size
        report()
        done.push({ partNumber: p.partNumber, eTag })
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))
  }
  return done.sort((a, b) => a.partNumber - b.partNumber)
}
