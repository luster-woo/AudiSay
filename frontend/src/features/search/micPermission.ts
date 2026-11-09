/**
 * 마이크 권한. 브라우저 권한은 세 가지 상태다.
 * - granted(허용됨): 팝업 없이 바로 쓴다
 * - prompt(아직 안 물어봄 · 팝업을 그냥 닫음): 녹음을 시작하면 브라우저가 허용 팝업을 띄운다
 * - denied(차단됨): 팝업이 뜨지 않는다. 웹 페이지가 대신 풀 수 없고, 사용자가 사이트 설정에서 바꿔야 한다
 * 상태 조회(navigator.permissions)는 크롬·엣지·사파리·최신 파이어폭스가 지원한다. 지원하지 않으면 'unknown'.
 */
export type MicState = 'granted' | 'prompt' | 'denied' | 'unknown'

export async function queryMic(): Promise<MicState> {
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
    return status?.state ?? 'unknown'
  } catch {
    return 'unknown' // 'microphone' 이름을 모르는 브라우저
  }
}

/** 권한 상태가 바뀌면 알린다(사이트 설정에서 허용으로 바꾼 경우 등). 반환값은 감시를 끄는 함수 */
export function watchMic(onChange: (state: MicState) => void): () => void {
  let status: PermissionStatus | null = null
  let stopped = false
  const handler = () => status && onChange(status.state)
  navigator.permissions
    ?.query({ name: 'microphone' as PermissionName })
    .then((s) => {
      if (stopped) return
      status = s
      s.addEventListener('change', handler)
    })
    .catch(() => {})
  return () => {
    stopped = true
    status?.removeEventListener('change', handler)
  }
}

export const MIC_MESSAGES = {
  unsupported: '이 브라우저에서는 음성 입력을 쓸 수 없어요.',
  asking: '브라우저가 마이크를 써도 되는지 물어봐요. 허용을 누르면 바로 들을게요.',
  denied:
    '마이크가 막혀 있어요. 주소창 왼쪽의 자물쇠 버튼을 누르고, 사이트 설정에서 마이크를 허용으로 바꾸면 쓸 수 있어요.',
  dismissed: '마이크 사용을 허용하지 않았어요. 다시 누르면 다시 물어봐요.',
  noDevice: '마이크가 연결돼 있지 않아요. 마이크를 연결한 뒤 다시 눌러 주세요.',
  busy: '다른 프로그램이 마이크를 쓰고 있어요. 그 프로그램을 끈 뒤 다시 눌러 주세요.',
  insecure: '이 주소에서는 마이크를 쓸 수 없어요.',
  other: '마이크를 켜지 못했어요. 다시 눌러 주세요.',
  recovered: '이제 마이크를 쓸 수 있어요.',
} as const

/**
 * getUserMedia 실패 이유 → 안내 문구.
 * 권한 거부(NotAllowedError)는 '차단됨'과 '팝업을 그냥 닫음'이 같은 오류로 오므로, 실패 뒤 상태를 다시 조회해 나눈다.
 */
export async function micErrorMessage(
  err: unknown,
): Promise<{ message: string; blocked: boolean }> {
  const name = err instanceof DOMException || err instanceof Error ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError': {
      const state = await queryMic()
      return state === 'prompt'
        ? { message: MIC_MESSAGES.dismissed, blocked: false }
        : { message: MIC_MESSAGES.denied, blocked: true }
    }
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { message: MIC_MESSAGES.noDevice, blocked: false }
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { message: MIC_MESSAGES.busy, blocked: false }
    case 'SecurityError':
      return { message: MIC_MESSAGES.insecure, blocked: false }
    default:
      return { message: MIC_MESSAGES.other, blocked: false }
  }
}
