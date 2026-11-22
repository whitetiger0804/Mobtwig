-- 리뷰·댓글 공감은 회원별 대상당 한 번 저장합니다.
CREATE TABLE review_like (
    id                BIGINT    NOT NULL AUTO_INCREMENT,
    member_id         BIGINT    NOT NULL,
    review_id         BIGINT    NULL,
    review_comment_id BIGINT    NULL,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_review_like_member_review UNIQUE (member_id, review_id),
    CONSTRAINT uk_review_like_member_comment UNIQUE (member_id, review_comment_id),
    INDEX idx_review_like_review (review_id),
    INDEX idx_review_like_comment (review_comment_id),
    CONSTRAINT fk_review_like_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_review_like_review FOREIGN KEY (review_id)
        REFERENCES review (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_review_like_comment FOREIGN KEY (review_comment_id)
        REFERENCES review_comment (id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_review_like_target CHECK (
        (review_id IS NOT NULL AND review_comment_id IS NULL)
        OR (review_id IS NULL AND review_comment_id IS NOT NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 신고는 접수와 중복 방지만 제공하며 최초 사유·상세를 보존합니다.
CREATE TABLE review_report (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    member_id         BIGINT       NOT NULL,
    review_id         BIGINT       NULL,
    review_comment_id BIGINT       NULL,
    reason            VARCHAR(20)  NOT NULL,
    detail            VARCHAR(500) NULL,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_review_report_member_review UNIQUE (member_id, review_id),
    CONSTRAINT uk_review_report_member_comment UNIQUE (member_id, review_comment_id),
    INDEX idx_review_report_review (review_id),
    INDEX idx_review_report_comment (review_comment_id),
    CONSTRAINT fk_review_report_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_review_report_review FOREIGN KEY (review_id)
        REFERENCES review (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_review_report_comment FOREIGN KEY (review_comment_id)
        REFERENCES review_comment (id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_review_report_target CHECK (
        (review_id IS NOT NULL AND review_comment_id IS NULL)
        OR (review_id IS NULL AND review_comment_id IS NOT NULL)),
    CONSTRAINT ck_review_report_reason CHECK (reason IN ('SPAM', 'ABUSE', 'INAPPROPRIATE', 'SPOILER', 'OTHER')),
    CONSTRAINT ck_review_report_detail CHECK (detail IS NULL OR CHAR_LENGTH(TRIM(detail)) >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
