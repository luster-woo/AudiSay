import { request } from './client'

/** 녹음한 말 → 글자 (POST /stt). 60초·10MB 이하, 알아듣지 못하면 CHAT_001 */
export const sttApi = {
  transcribe: (audio: Blob, videoId?: number) => {
    const form = new FormData()
    const ext = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'mp4' : 'webm'
    form.append('audio', audio, `voice.${ext}`)
    if (videoId != null) form.append('videoId', String(videoId))
    return request<{ text: string; latencyMs: number }>({ method: 'POST', url: '/stt', data: form })
  },
}
