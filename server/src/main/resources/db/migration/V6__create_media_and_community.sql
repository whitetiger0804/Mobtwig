-- V6: 회차 미디어·게시판·게시글·게시글 이미지·스티커·댓글·공감·신고
-- 기준: docs/테이블 정의서.md
-- 게시판별 말머리, 연결 작품, 스티커 개수, 글 상태 전환, 신고 비공개는 서비스가 처리합니다.

-- 회차 미디어 (회차 삭제 시 함께 삭제)
-- media_url은 파일 경로와 외부 링크 URL 어느 쪽이든 담습니다. Canvas 상호작용은 본문 파일이 정의합니다.
CREATE TABLE chapter_media (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    chapter_id  BIGINT       NOT NULL,
    book_id     BIGINT       NOT NULL,
    type        VARCHAR(20)  NOT NULL,
    media_url   VARCHAR(500) NOT NULL,
    title       VARCHAR(200) NULL,
    description TEXT         NULL,
    width       INT          NULL,
    height      INT          NULL,
    sort_order  INT          NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_chapter_media_chapter_order UNIQUE (chapter_id, sort_order),
    CONSTRAINT fk_chapter_media_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_chapter_media_chapter FOREIGN KEY (chapter_id, book_id)
        REFERENCES chapter (id, book_id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_chapter_media_type CHECK (type IN ('IMAGE', 'VIDEO', 'AUDIO')),
    CONSTRAINT ck_chapter_media_sort_order CHECK (sort_order >= 1),
    CONSTRAINT ck_chapter_media_size CHECK ((width IS NULL OR width >= 1) AND (height IS NULL OR height >= 1))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 게시판
-- WORK는 작품당 1개이며 작품이 PUBLISHED가 될 때 서비스가 만듭니다. TOPIC·PROMOTION은 아래 고정 데이터입니다.
CREATE TABLE board (
    id         BIGINT       NOT NULL AUTO_INCREMENT,
    type       VARCHAR(20)  NOT NULL,
    book_id    BIGINT       NULL,
    name       VARCHAR(100) NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_board_book UNIQUE (book_id),
    CONSTRAINT fk_board_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_board_type CHECK (type IN ('WORK', 'TOPIC', 'PROMOTION')),
    CONSTRAINT ck_board_target CHECK ((type = 'WORK' AND book_id IS NOT NULL AND name IS NULL)
        OR (type <> 'WORK' AND book_id IS NULL AND name IS NOT NULL)),
    CONSTRAINT ck_board_name CHECK (name IS NULL OR CHAR_LENGTH(TRIM(name)) >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 게시글 (DRAFT는 실제 삭제, 게시한 글은 status로 HIDDEN·DELETED 처리)
-- DRAFT는 제목·본문을 빈 값으로 둘 수 있고, published_at은 DRAFT일 때만 NULL입니다.
-- 스포일러 회차가 있으면 book_id가 있어야 합니다. 복합 FK는 NULL이 있으면 검사하지 않기 때문입니다.
CREATE TABLE post (
    id                 BIGINT       NOT NULL AUTO_INCREMENT,
    board_id           BIGINT       NOT NULL,
    book_id            BIGINT       NULL,
    member_id          BIGINT       NOT NULL,
    head               VARCHAR(20)  NOT NULL,
    title              VARCHAR(100) NOT NULL,
    body               TEXT         NOT NULL,
    spoiler_chapter_id BIGINT       NULL,
    status             VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
    published_at       TIMESTAMP    NULL,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_post_board_status_published (board_id, status, published_at),
    INDEX idx_post_member_status (member_id, status),
    CONSTRAINT fk_post_board FOREIGN KEY (board_id)
        REFERENCES board (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_post_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_post_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_post_spoiler_chapter FOREIGN KEY (spoiler_chapter_id, book_id)
        REFERENCES chapter (id, book_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_post_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'HIDDEN', 'DELETED')),
    CONSTRAINT ck_post_head CHECK (head IN ('IMPRESSION', 'QUESTION', 'THEORY', 'FREE', 'STORY', 'PROMOTION')),
    CONSTRAINT ck_post_spoiler_book CHECK (spoiler_chapter_id IS NULL OR book_id IS NOT NULL),
    CONSTRAINT ck_post_published_at CHECK ((status = 'DRAFT') = (published_at IS NULL)),
    CONSTRAINT ck_post_published_content CHECK (status = 'DRAFT'
        OR (CHAR_LENGTH(TRIM(title)) >= 1 AND CHAR_LENGTH(TRIM(body)) >= 1))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 게시글 이미지 (글 삭제 시 함께 삭제)
-- rep_key는 대표 이미지만 1이고 나머지는 NULL이라, 글당 대표 이미지를 최대 1장으로 제한합니다.
CREATE TABLE post_image (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    post_id           BIGINT       NOT NULL,
    image_url         VARCHAR(500) NOT NULL,
    width             INT          NOT NULL,
    height            INT          NOT NULL,
    sort_order        INT          NOT NULL,
    is_representative BOOLEAN      NOT NULL DEFAULT FALSE,
    rep_key           TINYINT      GENERATED ALWAYS AS (IF(is_representative, 1, NULL)) STORED NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_post_image_post_rep UNIQUE (post_id, rep_key),
    CONSTRAINT uk_post_image_post_order UNIQUE (post_id, sort_order),
    CONSTRAINT fk_post_image_post FOREIGN KEY (post_id)
        REFERENCES post (id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_post_image_size CHECK (width >= 1 AND height >= 1),
    CONSTRAINT ck_post_image_sort_order CHECK (sort_order >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 스티커 (고정 4종, 아래 고정 데이터)
CREATE TABLE sticker (
    id        BIGINT       NOT NULL AUTO_INCREMENT,
    code      VARCHAR(30)  NOT NULL,
    name      VARCHAR(30)  NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_sticker_code UNIQUE (code)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 게시글 스티커 (글 삭제 시 함께 삭제)
-- 같은 스티커를 여러 번 넣을 수 있습니다. 글당 최대 8개는 서비스가 검증합니다.
CREATE TABLE post_sticker (
    id         BIGINT NOT NULL AUTO_INCREMENT,
    post_id    BIGINT NOT NULL,
    sort_order INT    NOT NULL,
    sticker_id BIGINT NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_post_sticker_post_order UNIQUE (post_id, sort_order),
    CONSTRAINT fk_post_sticker_post FOREIGN KEY (post_id)
        REFERENCES post (id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_post_sticker_sticker FOREIGN KEY (sticker_id)
        REFERENCES sticker (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_post_sticker_sort_order CHECK (sort_order >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 게시글 댓글 (실제 삭제)
-- body가 NULL이면 스티커만 남긴 댓글입니다. 본문 또는 스티커 중 하나가 있는지는 서비스가 검증합니다.
-- book_id는 글의 post.book_id를 복사한 값이며, 같은지는 서비스가 보장합니다.
CREATE TABLE post_comment (
    id                 BIGINT        NOT NULL AUTO_INCREMENT,
    post_id            BIGINT        NOT NULL,
    book_id            BIGINT        NULL,
    member_id          BIGINT        NOT NULL,
    body               VARCHAR(2000) NULL,
    spoiler_chapter_id BIGINT        NULL,
    created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_post_comment_post_created (post_id, created_at),
    CONSTRAINT fk_post_comment_post FOREIGN KEY (post_id)
        REFERENCES post (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_post_comment_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_post_comment_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_post_comment_spoiler_chapter FOREIGN KEY (spoiler_chapter_id, book_id)
        REFERENCES chapter (id, book_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_post_comment_body CHECK (body IS NULL OR CHAR_LENGTH(TRIM(body)) >= 1),
    CONSTRAINT ck_post_comment_spoiler_book CHECK (spoiler_chapter_id IS NULL OR book_id IS NOT NULL)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 댓글 스티커 (댓글 삭제 시 함께 삭제)
-- 같은 스티커를 여러 번 넣을 수 있습니다. 댓글당 최대 4개는 서비스가 검증합니다.
CREATE TABLE post_comment_sticker (
    id         BIGINT NOT NULL AUTO_INCREMENT,
    comment_id BIGINT NOT NULL,
    sort_order INT    NOT NULL,
    sticker_id BIGINT NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_post_comment_sticker_comment_order UNIQUE (comment_id, sort_order),
    CONSTRAINT fk_post_comment_sticker_comment FOREIGN KEY (comment_id)
        REFERENCES post_comment (id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_post_comment_sticker_sticker FOREIGN KEY (sticker_id)
        REFERENCES sticker (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_post_comment_sticker_sort_order CHECK (sort_order >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 공감 (회원별 글당 1번, 취소는 실제 삭제)
-- 공감 수는 캐시하지 않고 COUNT로 계산합니다. 탈퇴해도 남깁니다.
CREATE TABLE post_reaction (
    id         BIGINT    NOT NULL AUTO_INCREMENT,
    post_id    BIGINT    NOT NULL,
    member_id  BIGINT    NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_post_reaction_post_member UNIQUE (post_id, member_id),
    CONSTRAINT fk_post_reaction_post FOREIGN KEY (post_id)
        REFERENCES post (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_post_reaction_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 신고 (회원별 글당 1번)
-- 처리 상태는 두지 않습니다. 신고 내용은 다른 회원에게 내려주지 않습니다(서비스). 탈퇴해도 남깁니다.
CREATE TABLE post_report (
    id                 BIGINT       NOT NULL AUTO_INCREMENT,
    post_id            BIGINT       NOT NULL,
    reporter_member_id BIGINT       NOT NULL,
    reason             VARCHAR(20)  NOT NULL,
    detail             VARCHAR(500) NULL,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_post_report_post_reporter UNIQUE (post_id, reporter_member_id),
    CONSTRAINT fk_post_report_post FOREIGN KEY (post_id)
        REFERENCES post (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_post_report_reporter_member FOREIGN KEY (reporter_member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_post_report_reason CHECK (reason IN ('SPAM', 'ABUSE', 'INAPPROPRIATE', 'SPOILER', 'OTHER')),
    CONSTRAINT ck_post_report_detail CHECK (detail IS NULL OR CHAR_LENGTH(TRIM(detail)) >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 고정 데이터: 주제별·홍보 게시판
INSERT INTO board (type, name) VALUES
    ('TOPIC', '독서 이야기'),
    ('TOPIC', '창작 이야기'),
    ('PROMOTION', '작품 홍보');

-- 고정 데이터: 스티커 4종
-- 이미지 파일을 실제로 둘 위치(서버 정적 경로 또는 CDN)는 아직 정하지 않았습니다.
INSERT INTO sticker (code, name, image_url) VALUES
    ('WAVE', '반가워요', '/stickers/emote-wave.svg'),
    ('CHEER', '응원해요', '/stickers/emote-cheer.svg'),
    ('THINK', '생각 중', '/stickers/emote-think.svg'),
    ('THANKS', '고마워요', '/stickers/emote-thanks.svg');
