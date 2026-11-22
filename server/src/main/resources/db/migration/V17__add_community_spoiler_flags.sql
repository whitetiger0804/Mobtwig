-- 회차 선택 없이 게시글·댓글의 스포일러 여부를 설정합니다.
-- 기존 회차 지정 스포일러는 공개되지 않도록 표시를 이관합니다.
ALTER TABLE post ADD COLUMN has_spoiler BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE post_comment ADD COLUMN has_spoiler BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE post SET has_spoiler=TRUE WHERE spoiler_chapter_id IS NOT NULL;
UPDATE post_comment SET has_spoiler=TRUE WHERE spoiler_chapter_id IS NOT NULL;
