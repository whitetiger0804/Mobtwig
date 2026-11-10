-- 서버 revision과 검증 당시 텍스트 해시를 추가합니다.
ALTER TABLE reading_progress
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD CONSTRAINT ck_reading_progress_revision CHECK (revision >= 1);
