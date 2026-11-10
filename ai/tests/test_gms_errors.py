"""GMS 오류 분류 (2026-11-10 점검): 키·권한·모델 오류를 '영상 볼 수 없음'(다시 할 수 없음)으로 보지 않는다."""
from app.gms.client import video_unavailable


def test_video_errors_are_unavailable():
    assert video_unavailable("400 INVALID_ARGUMENT: The video is private.")
    assert video_unavailable("Cannot fetch content from the provided URL")
    assert video_unavailable("403 PERMISSION_DENIED: the caller does not have access to this YouTube video")
    assert video_unavailable("Video is not available in your country")


def test_key_and_model_errors_are_not_unavailable():
    assert not video_unavailable("403 PERMISSION_DENIED. {'error': {'message': 'API key expired. Please renew the API key.'}}")
    assert not video_unavailable("404 NOT_FOUND: models/gemini-9 is not available for generateContent")
    assert not video_unavailable("503 UNAVAILABLE: The model is overloaded.")
