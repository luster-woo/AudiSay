-- 챗봇 281~283·인증 서류 판정 286용 스키마
-- 1) 발화 분류에 SEARCH_VIDEO(다른 영상 찾기) 추가
-- 2) 장면 이동을 무엇으로 찾았는지(seek_source): chapters.keywords 검색이면 KEYWORD, LLM이 골랐으면 LLM
-- 3) AI 호출 용도에 VERIFY(시각장애인 인증 서류 판정) 추가

ALTER TABLE chat_logs DROP CONSTRAINT ck_chat_logs_2;
ALTER TABLE chat_logs ADD CONSTRAINT ck_chat_logs_2
    CHECK (intent IN ('QUESTION', 'SCENE_NOW', 'SEEK_SCENE', 'SEEK_TIME', 'SETTING', 'ACTION', 'SEARCH_VIDEO', 'UNKNOWN'));

ALTER TABLE chat_logs ADD COLUMN seek_source VARCHAR(10);
ALTER TABLE chat_logs ADD CONSTRAINT ck_chat_logs_4 CHECK (seek_source IS NULL OR seek_source IN ('KEYWORD', 'LLM'));

ALTER TABLE ai_call_logs DROP CONSTRAINT ck_ai_call_logs_1;
ALTER TABLE ai_call_logs ADD CONSTRAINT ck_ai_call_logs_1
    CHECK (purpose IN ('STT', 'DESCRIBE', 'SHORTEN', 'SUMMARY', 'CHAPTER', 'CLASSIFY', 'QUESTION', 'INTENT', 'TTS', 'VERIFY'));

COMMENT ON COLUMN chat_logs.intent IS '발화 분류 (QUESTION / SCENE_NOW / SEEK_SCENE / SEEK_TIME / SETTING / ACTION / SEARCH_VIDEO / UNKNOWN)';
COMMENT ON COLUMN chat_logs.seek_source IS '장면 찾은 방법 (KEYWORD / LLM, SEEK_SCENE)';
COMMENT ON COLUMN ai_call_logs.purpose IS '용도 (STT / DESCRIBE / SHORTEN / SUMMARY / CHAPTER / CLASSIFY / QUESTION / INTENT / TTS / VERIFY)';
