-- 기존 텍스트 책갈피는 원문 일치를 증명할 해시가 없어 재확인 상태로 표시합니다.
ALTER TABLE bookmark
    ADD COLUMN content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL;
