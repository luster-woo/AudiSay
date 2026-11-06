"""TTS 끝 잡음 자르기(clean_tail)·앞 WAV 헤더 떼기(strip_wav_header)와 길이 계산. ffmpeg·GMS는 부르지 않는다."""
import struct
from array import array

from app.pipeline.tts import SR, clean_tail, duration_ms, line_key, progress_step, strip_wav_header, summary_key


def pcm(*parts: tuple[float, int]) -> bytes:
    """[(초, 진폭)] → 16bit PCM. 진폭은 그 구간의 샘플 값(일정)."""
    s = array("h")
    for sec, amp in parts:
        s.extend([amp] * int(SR * sec))
    return s.tobytes()


def test_quiet_ending_is_untouched():
    data = pcm((0.5, 6000), (0.3, 0))
    assert clean_tail(data) == data


def test_loud_tail_after_silence_is_cut():
    data = pcm((0.5, 6000), (0.3, 0), (0.2, 20000))  # 말 → 조용 → 끝까지 큰 잡음
    out = clean_tail(data)
    assert len(out) < len(data)
    assert len(out) >= int(SR * 0.5) * 2  # 말 부분은 남는다
    tail = array("h")
    tail.frombytes(out[-2 * (SR // 100):])
    assert max(map(abs, tail)) < 20000  # 잘린 끝은 페이드아웃되어 잡음 음량이 아니다


def test_loud_ending_without_silence_is_untouched():
    data = pcm((0.5, 9000))  # 조용한 구간이 없으면 어디서 자를지 모르므로 그대로
    assert clean_tail(data) == data


def test_duration_and_keys():
    assert duration_ms(pcm((1.0, 0))) == 1000
    assert line_key(7, 42, "골을 넣는다.").startswith("tts/7/42-") and line_key(7, 42, "골을 넣는다.").endswith(".mp3")
    assert line_key(7, 42, "골을 넣는다.") != line_key(7, 42, "골을 넣었다.")  # 문장이 고쳐지면 새 이름
    assert summary_key(7) == "tts/summary/7.mp3"


def test_progress_in_ten_percent_steps():
    """BE 요청(2026-10-29): job.tts PROGRESS는 80~100을 10% 단위로."""
    assert [progress_step(n, 10) for n in range(11)] == [80, 80, 80, 80, 80, 90, 90, 90, 90, 90, 100]
    assert progress_step(1, 3) == 80 and progress_step(2, 3) == 90
    assert progress_step(0, 0) == 100


def wav(data: bytes, extra: bytes = b"") -> bytes:
    """PCM 앞에 WAV 헤더(fmt, 있으면 다른 덩어리)를 붙인다."""
    fmt = b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16)
    body = b"WAVE" + fmt + extra + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


def test_wav_header_is_stripped():
    """헤더를 PCM으로 읽으면 해설 맨 앞에 "딱" 소리가 난다(2026-11-06)."""
    data = pcm((0.1, 0), (0.2, 6000))
    assert strip_wav_header(wav(data)) == data
    assert strip_wav_header(wav(data, b"LIST" + struct.pack("<I", 3) + b"abc" + bytes(1))) == data  # 홀수 크기 덩어리도 건너뜀


def test_raw_pcm_is_untouched():
    data = pcm((0.2, 6000))
    assert strip_wav_header(data) == data
