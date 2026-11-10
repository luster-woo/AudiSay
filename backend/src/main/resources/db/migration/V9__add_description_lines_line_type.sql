-- 375 해설 문장 종류: 외국어 대사를 한국어로 읽어 주는 문장(DIALOGUE)을 화면 해설(NARRATION)과 가른다.
-- 플레이어는 DIALOGUE를 '외국어 번역 읽기' 설정으로 켜고 끄고, 영상을 멈추지 않고 겹쳐 읽는다. 챗봇은 해설 근거에서 뺀다.
-- 이 칸이 생기기 전 해설은 모두 NARRATION이라, 읽는 쪽은 대사 글과 비교하는 규칙(DubLines)도 함께 본다

ALTER TABLE description_lines ADD COLUMN line_type VARCHAR(10) NOT NULL DEFAULT 'NARRATION';
ALTER TABLE description_lines ADD CONSTRAINT ck_description_lines_4 CHECK (line_type IN ('NARRATION', 'DIALOGUE'));

COMMENT ON COLUMN description_lines.line_type IS '문장 종류 (NARRATION 화면 해설 / DIALOGUE 외국어 대사 번역)';
