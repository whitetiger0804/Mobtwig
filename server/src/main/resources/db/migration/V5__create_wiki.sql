-- V5: 설정집 항목·설정집 개방 범위
-- 기준: docs/테이블 정의서.md
-- 공개 판단(잠금)과 잠긴 항목의 응답 제한은 서비스가 처리합니다.

-- 설정집 항목 (실제 삭제)
-- reveal_chapter_id는 항목이 처음 공개되는 회차입니다. 공개된 회차만 허용하는 검증은 서비스가 합니다.
CREATE TABLE wiki_entry (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    book_id           BIGINT       NOT NULL,
    reveal_chapter_id BIGINT       NOT NULL,
    type              VARCHAR(20)  NOT NULL,
    subtype           VARCHAR(30)  NULL,
    name              VARCHAR(100) NOT NULL,
    tagline           VARCHAR(100) NULL,
    summary           VARCHAR(200) NOT NULL,
    body              TEXT         NOT NULL,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_wiki_entry_book_name UNIQUE (book_id, name),
    INDEX idx_wiki_entry_book_type (book_id, type),
    INDEX idx_wiki_entry_reveal (reveal_chapter_id, book_id),
    CONSTRAINT fk_wiki_entry_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_wiki_entry_reveal_chapter FOREIGN KEY (reveal_chapter_id, book_id)
        REFERENCES chapter (id, book_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_wiki_entry_type CHECK (type IN ('CHARACTER', 'WORLD', 'ITEM', 'CONCEPT')),
    CONSTRAINT ck_wiki_entry_name CHECK (CHAR_LENGTH(TRIM(name)) >= 1),
    CONSTRAINT ck_wiki_entry_summary CHECK (CHAR_LENGTH(TRIM(summary)) >= 1),
    CONSTRAINT ck_wiki_entry_body CHECK (CHAR_LENGTH(TRIM(body)) >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 설정집 개방 범위 (회원별 작품당 1건)
-- 행이 있으면 수동, 없으면 읽기 기록 기준 자동입니다. 자동으로 되돌리면 행을 실제 삭제합니다.
-- 스포일러 확인 동의는 저장하지 않습니다.
CREATE TABLE member_wiki_range (
    id               BIGINT    NOT NULL AUTO_INCREMENT,
    member_id        BIGINT    NOT NULL,
    book_id          BIGINT    NOT NULL,
    limit_chapter_id BIGINT    NOT NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_member_wiki_range_member_book UNIQUE (member_id, book_id),
    CONSTRAINT fk_member_wiki_range_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_member_wiki_range_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_member_wiki_range_limit_chapter FOREIGN KEY (limit_chapter_id, book_id)
        REFERENCES chapter (id, book_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
