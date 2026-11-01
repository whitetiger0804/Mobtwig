-- V3: 서재·찜·읽기 위치·최근 본 작품·북마크·하이라이트
-- 기준: docs/테이블 정의서.md
-- 회차 참조는 (chapter_id, book_id) → chapter(id, book_id) 복합 FK로 다른 작품의 회차를 막습니다.

-- 서재 (회원별 작품당 1건)
CREATE TABLE library_book (
    id          BIGINT      NOT NULL AUTO_INCREMENT,
    member_id   BIGINT      NOT NULL,
    book_id     BIGINT      NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'WANT_TO_READ',
    is_favorite BOOLEAN     NOT NULL DEFAULT FALSE,
    is_hidden   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_library_book_member_book UNIQUE (member_id, book_id),
    INDEX idx_library_book_member_status (member_id, status, updated_at),
    CONSTRAINT fk_library_book_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_library_book_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_library_book_status CHECK (status IN ('WANT_TO_READ', 'READING', 'COMPLETED'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 찜
CREATE TABLE wishlist (
    id         BIGINT    NOT NULL AUTO_INCREMENT,
    member_id  BIGINT    NOT NULL,
    book_id    BIGINT    NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_wishlist_member_book UNIQUE (member_id, book_id),
    INDEX idx_wishlist_member_created (member_id, created_at),
    CONSTRAINT fk_wishlist_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_wishlist_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 읽기 위치 (회원별 작품당 1건)
-- last_read_at은 ON UPDATE를 두지 않고 위치를 저장할 때 서비스가 넣습니다.
CREATE TABLE reading_progress (
    id              BIGINT    NOT NULL AUTO_INCREMENT,
    member_id       BIGINT    NOT NULL,
    book_id         BIGINT    NOT NULL,
    chapter_id      BIGINT    NOT NULL,
    chapter_offset  INT       NOT NULL DEFAULT 0,
    max_chapter_id  BIGINT    NULL,
    content_version INT       NOT NULL,
    last_read_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_reading_progress_member_book UNIQUE (member_id, book_id),
    INDEX idx_reading_progress_member_last_read (member_id, last_read_at),
    CONSTRAINT fk_reading_progress_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_reading_progress_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_reading_progress_chapter FOREIGN KEY (chapter_id, book_id)
        REFERENCES chapter (id, book_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_reading_progress_max_chapter FOREIGN KEY (max_chapter_id, book_id)
        REFERENCES chapter (id, book_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_reading_progress_chapter_offset CHECK (chapter_offset >= 0),
    CONSTRAINT ck_reading_progress_content_version CHECK (content_version >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 최근 본 작품
-- last_viewed_at은 ON UPDATE를 두지 않고 다시 볼 때 서비스가 넣습니다.
CREATE TABLE recent_view (
    id             BIGINT    NOT NULL AUTO_INCREMENT,
    member_id      BIGINT    NOT NULL,
    book_id        BIGINT    NOT NULL,
    last_viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_recent_view_member_book UNIQUE (member_id, book_id),
    INDEX idx_recent_view_member_last_viewed (member_id, last_viewed_at),
    CONSTRAINT fk_recent_view_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_recent_view_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 북마크
CREATE TABLE bookmark (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    member_id       BIGINT       NOT NULL,
    book_id         BIGINT       NOT NULL,
    chapter_id      BIGINT       NOT NULL,
    chapter_offset  INT          NOT NULL,
    snippet         VARCHAR(200) NULL,
    content_version INT          NOT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_bookmark_member_position UNIQUE (member_id, chapter_id, chapter_offset),
    INDEX idx_bookmark_member_book (member_id, book_id, created_at),
    CONSTRAINT fk_bookmark_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_bookmark_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_bookmark_chapter FOREIGN KEY (chapter_id, book_id)
        REFERENCES chapter (id, book_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_bookmark_chapter_offset CHECK (chapter_offset >= 0),
    CONSTRAINT ck_bookmark_content_version CHECK (content_version >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 하이라이트
CREATE TABLE highlight (
    id              BIGINT        NOT NULL AUTO_INCREMENT,
    member_id       BIGINT        NOT NULL,
    book_id         BIGINT        NOT NULL,
    chapter_id      BIGINT        NOT NULL,
    start_offset    INT           NOT NULL,
    end_offset      INT           NOT NULL,
    snippet         VARCHAR(500)  NULL,
    content_version INT           NOT NULL,
    color           VARCHAR(20)   NOT NULL DEFAULT 'YELLOW',
    memo            VARCHAR(1000) NULL,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_highlight_member_range UNIQUE (member_id, chapter_id, start_offset, end_offset),
    INDEX idx_highlight_member_book (member_id, book_id, created_at),
    CONSTRAINT fk_highlight_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_highlight_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_highlight_chapter FOREIGN KEY (chapter_id, book_id)
        REFERENCES chapter (id, book_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_highlight_start_offset CHECK (start_offset >= 0),
    CONSTRAINT ck_highlight_range CHECK (end_offset >= start_offset),
    CONSTRAINT ck_highlight_content_version CHECK (content_version >= 1),
    CONSTRAINT ck_highlight_color CHECK (color IN ('YELLOW', 'GREEN'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
