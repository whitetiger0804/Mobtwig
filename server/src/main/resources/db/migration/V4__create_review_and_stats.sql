-- V4: 리뷰·리뷰 댓글·일별 통계
-- 기준: docs/테이블 정의서.md
-- book의 average_rating·review_count·view_count 캐시 갱신은 서비스가 처리하며 이 파일은 book을 바꾸지 않습니다.

-- 리뷰 (soft delete)
-- content가 NULL이면 별점만 남긴 리뷰입니다.
-- active_key는 삭제되지 않은 행만 1이고 삭제되면 NULL이 되어, 삭제 후 같은 작품에 다시 쓸 수 있습니다.
CREATE TABLE review (
    id         BIGINT        NOT NULL AUTO_INCREMENT,
    book_id    BIGINT        NOT NULL,
    member_id  BIGINT        NOT NULL,
    rating     TINYINT       NOT NULL,
    content    VARCHAR(1000) NULL,
    created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP     NULL,
    active_key TINYINT       GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_review_book_member_active UNIQUE (book_id, member_id, active_key),
    INDEX idx_review_book_created (book_id, created_at),
    CONSTRAINT fk_review_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_review_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_review_rating CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT ck_review_content CHECK (content IS NULL OR CHAR_LENGTH(TRIM(content)) >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 리뷰 댓글 (실제 삭제)
CREATE TABLE review_comment (
    id         BIGINT       NOT NULL AUTO_INCREMENT,
    review_id  BIGINT       NOT NULL,
    member_id  BIGINT       NOT NULL,
    content    VARCHAR(500) NOT NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_review_comment_review_created (review_id, created_at),
    CONSTRAINT fk_review_comment_review FOREIGN KEY (review_id)
        REFERENCES review (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_review_comment_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_review_comment_content CHECK (CHAR_LENGTH(TRIM(content)) >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 일별 통계 (작품당 하루 1행)
-- stat_date는 KST 날짜를 앱이 계산해 넣습니다.
CREATE TABLE book_stat_daily (
    id         BIGINT NOT NULL AUTO_INCREMENT,
    book_id    BIGINT NOT NULL,
    stat_date  DATE   NOT NULL,
    view_count INT    NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_book_stat_daily_book_date UNIQUE (book_id, stat_date),
    INDEX idx_book_stat_daily_date_view (stat_date, view_count),
    CONSTRAINT fk_book_stat_daily_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_book_stat_daily_view_count CHECK (view_count >= 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
