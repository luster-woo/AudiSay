-- 375 외국어 대사 번역 읽기: 유튜브 영상의 외국어 대사를 AI가 한국어로 옮겨 그 시각에 읽어 준다.
-- 해설(sound_mix)·자막 읽기(subtitle_reading)와 따로 켜고 끈다(해설을 꺼도 번역은 들을 수 있게)

ALTER TABLE user_settings ADD COLUMN translation_reading BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN user_settings.translation_reading IS '외국어 대사 번역 읽기';
