-- 목소리를 서비스 전체에서 하나로 고정해(V2 참고) 해설 문장별 목소리 기록도 필요 없어졌다.

ALTER TABLE description_lines DROP COLUMN voice_code;
