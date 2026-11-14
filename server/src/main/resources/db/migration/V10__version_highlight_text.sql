-- 기존 텍스트 하이라이트는 원문을 재확인하고 매거진은 null 해시를 유지합니다.
ALTER TABLE highlight
    ADD COLUMN content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    DROP INDEX uk_highlight_member_range,
    ADD UNIQUE INDEX uk_highlight_member_revision
        (member_id, chapter_id, start_offset, end_offset, content_version, (COALESCE(content_hash, '')));
