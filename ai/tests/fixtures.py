"""Gemini 응답 모양을 흉내 낸 작은 예시 (3분 10초 영상)."""

RAW = {
    "category": "예능",
    "summary_30s": "두 사람이 부엌에서 라면을 끓이며 맛을 평가한다.",
    "dialogue": [
        {"start": "00:05", "end": "00:09", "speaker": "김철수", "text": "오늘은 라면을 끓여 볼게요.", "language": "ko", "translation": None},
        {"start": "00:20", "end": "00:24", "speaker": None, "text": "물이 끓기 시작했어요.", "language": "ko", "translation": None},
        {"start": "02:00", "end": "02:06", "speaker": "김철수", "text": "이제 맛을 볼까요?", "language": "ko", "translation": None},
        {"start": "02:50", "end": "03:00", "speaker": None, "text": "정말 맛있네요.", "language": "ko", "translation": None},
    ],
    "scenes": [
        {"start": "00:00", "end": "01:10", "title": "앞치마를 두른 남성이 부엌에 선다",
         "people": [{"name": "김철수", "basis": "이름 자막", "appearance": "파란 앞치마의 30대 남성"}],
         "screen_text": [
             {"text": "김철수", "text_type": "NAME_TAG", "importance": "상", "same_as_dialogue": False},
             {"text": "라면 끓이기 대결", "text_type": "TITLE", "importance": "상", "same_as_dialogue": False},
         ]},
        {"start": "01:10", "end": "02:10", "title": "냄비에 면을 넣는다",
         "people": [{"name": None, "basis": None, "appearance": "흰 셔츠의 20대 여성"}],
         "screen_text": [{"text": "3분 경과", "text_type": "OTHER", "importance": "중", "same_as_dialogue": False}]},
        {"start": "02:10", "end": "03:10", "title": "두 사람이 시식한다", "people": [], "screen_text": []},
    ],
    "lines": [
        {"at": "00:00", "level": 1, "text": "파란 앞치마를 두른 김철수가 부엌에 선다."},
        {"at": "00:02", "level": 3, "text": "부엌 벽에는 하얀 타일이 붙어 있다."},
        {"at": "00:07", "level": 2, "text": "김철수가 냄비에 물을 붓는다."},  # 대사 중간 → 00:09로
        {"at": "01:10", "level": 1, "text": "흰 셔츠의 여성이 냄비에 면을 넣는다."},
        {"at": "01:15", "level": 2, "text": "그는 젓가락으로 면을 젓는다."},  # 앞 문장을 가리키는 말
        {"at": "02:03", "level": 1, "text": "이제 맛을 볼까요?"},  # 대사 반복 + 대사 중간
        {"at": "02:40", "level": 2, "text": "라면 끓이기 대결 자막 아래에서 두 사람이 라면을 한 젓가락씩 들어 올려 천천히 맛을 보고 서로 마주 보며 고개를 크게 끄덕인다."},
    ],
}
