-- 285 챗봇 답변: 지금까지 줄거리(RECAP), 지금 이후 내용을 골라 들은 답변(FUTURE)
-- 1) 발화 분류에 RECAP 추가, 답변을 저장하는 intent에도 RECAP
-- 2) 답변 근거에 FUTURE(사용자가 "지금 이후 내용 들을게요"를 고른 뒤의 답변) 추가

ALTER TABLE chat_logs DROP CONSTRAINT ck_chat_logs_2;
ALTER TABLE chat_logs ADD CONSTRAINT ck_chat_logs_2
    CHECK (intent IN ('QUESTION', 'SCENE_NOW', 'SEEK_SCENE', 'SEEK_TIME', 'SETTING', 'ACTION', 'SEARCH_VIDEO', 'RECAP', 'UNKNOWN'));

ALTER TABLE chat_logs DROP CONSTRAINT ck_chat_logs_3;
ALTER TABLE chat_logs ADD CONSTRAINT ck_chat_logs_3
    CHECK (answer_source IS NULL OR answer_source IN ('STORED', 'FRAME', 'GEMINI_REQUERY', 'CACHE', 'UNANSWERABLE', 'FUTURE'));

ALTER TABLE chat_logs DROP CONSTRAINT ck_chat_logs_answer;
ALTER TABLE chat_logs ADD CONSTRAINT ck_chat_logs_answer
    CHECK (intent IN ('QUESTION', 'SCENE_NOW', 'RECAP') OR (answer_text IS NULL AND answer_source IS NULL));

COMMENT ON COLUMN chat_logs.intent IS '발화 분류 (QUESTION / SCENE_NOW / SEEK_SCENE / SEEK_TIME / SETTING / ACTION / SEARCH_VIDEO / RECAP / UNKNOWN)';
COMMENT ON COLUMN chat_logs.answer_source IS '답변 근거 (STORED / FRAME / GEMINI_REQUERY / CACHE / UNANSWERABLE / FUTURE)';
