"""TTS 끝 잡음 자르기(clean_tail)와 길이 계산. ffmpeg·GMS는 부르지 않는다."""
from array import array

from app.pipeline.tts import SR, clean_tail, duration_ms, line_key, progress_step, summary_key


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
    assert line_key(7, 42) == "audio/lines/7/42.mp3"
    assert summary_key(7) == "audio/summary/7.mp3"


def test_progress_in_ten_percent_steps():
    """BE 요청(2026-10-29): job.tts PROGRESS는 80~100을 10% 단위로."""
    assert [progress_step(n, 10) for n in range(11)] == [80, 80, 80, 80, 80, 90, 90, 90, 90, 90, 100]
    assert progress_step(1, 3) == 80 and progress_step(2, 3) == 90
    assert progress_step(0, 0) == 100
