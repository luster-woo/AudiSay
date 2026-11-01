/** 음성 입력 시작음 '띠' (원칙 1장: 시작음은 하나로 통일). 소리 파일 없이 짧은 사인파로 낸다 */
export function playBeep() {
  try {
    const Ctx = window.AudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.value = 0.15
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.18)
    osc.onended = () => void ctx.close()
  } catch {
    // 소리를 못 내도 안내 문구로 시작을 알 수 있다
  }
}
