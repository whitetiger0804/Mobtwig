CREATE TABLE chapter_text_version (
    chapter_id BIGINT NOT NULL,
    content_version INT NOT NULL,
    content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (chapter_id, content_version),
    CONSTRAINT fk_chapter_text_version_chapter FOREIGN KEY (chapter_id)
        REFERENCES chapter (id) ON DELETE CASCADE,
    CONSTRAINT ck_chapter_text_version_positive CHECK (content_version >= 1)
) ENGINE=InnoDB;

-- Existing NULL hashes cannot establish which text was displayed.
ALTER TABLE reading_progress ADD COLUMN version_bound BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookmark ADD COLUMN version_bound BOOLEAN NOT NULL DEFAULT FALSE;
