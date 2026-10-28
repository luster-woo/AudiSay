-- 해설 목소리 선택(SND-05) 제거: 목소리를 서비스 전체에서 하나로 고정해 회원별 목소리 설정이 필요 없어졌다.
-- description_lines.voice_code는 음성을 만든 목소리 기록용으로 남긴다.

ALTER TABLE user_settings DROP COLUMN voice_code;
