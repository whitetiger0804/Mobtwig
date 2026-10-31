-- V1: 회원·읽기 설정·저자·장르·카테고리·작품·회차·연결 테이블
-- 기준: docs/테이블 정의서.md

-- 회원
CREATE TABLE member (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname      VARCHAR(30)  NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'USER',
    status        VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    withdrawn_at  TIMESTAMP    NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_member_email UNIQUE (email),
    CONSTRAINT uk_member_nickname UNIQUE (nickname),
    CONSTRAINT ck_member_role CHECK (role IN ('USER', 'ADMIN')),
    CONSTRAINT ck_member_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'WITHDRAWN')),
    CONSTRAINT ck_member_withdrawn_at CHECK (status <> 'WITHDRAWN' OR withdrawn_at IS NOT NULL)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 읽기 설정 (회원 1:1)
CREATE TABLE member_reading_setting (
    id                BIGINT      NOT NULL AUTO_INCREMENT,
    member_id         BIGINT      NOT NULL,
    font_size_level   TINYINT     NOT NULL DEFAULT 3,
    font_family       VARCHAR(20) NOT NULL DEFAULT 'GOTHIC',
    theme             VARCHAR(20) NOT NULL DEFAULT 'CREAM',
    page_turn_mode    VARCHAR(20) NOT NULL DEFAULT 'SCROLL',
    animation_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
    sound_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at        TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_member_reading_setting_member UNIQUE (member_id),
    CONSTRAINT fk_member_reading_setting_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_member_reading_setting_font_size_level CHECK (font_size_level BETWEEN 1 AND 5),
    CONSTRAINT ck_member_reading_setting_font_family CHECK (font_family IN ('GOTHIC', 'MYEONGJO')),
    CONSTRAINT ck_member_reading_setting_theme CHECK (theme IN ('CREAM', 'LIGHT_YELLOW', 'LIGHT_GRAY', 'DARK')),
    CONSTRAINT ck_member_reading_setting_page_turn_mode CHECK (page_turn_mode IN ('SCROLL', 'PAGE'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 저자
CREATE TABLE author (
    id         BIGINT       NOT NULL AUTO_INCREMENT,
    name       VARCHAR(100) NOT NULL,
    bio        TEXT         NULL,
    field      VARCHAR(100) NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FULLTEXT INDEX ft_author_name (name) WITH PARSER ngram
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 장르
CREATE TABLE genre (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    name          VARCHAR(50) NOT NULL,
    display_order INT         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_genre_name UNIQUE (name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 카테고리
CREATE TABLE category (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    name          VARCHAR(50)  NOT NULL,
    description   VARCHAR(255) NULL,
    display_order INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT uk_category_name UNIQUE (name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 작품
-- file_format, publish_cycle은 값 목록이 확정되지 않아 CHECK를 두지 않습니다.
CREATE TABLE book (
    id              BIGINT        NOT NULL AUTO_INCREMENT,
    content_type    VARCHAR(20)   NOT NULL,
    slug            VARCHAR(100)  NOT NULL,
    title           VARCHAR(200)  NOT NULL,
    description     TEXT          NULL,
    cover_image_url VARCHAR(500)  NULL,
    published_date  DATE          NULL,
    language        VARCHAR(10)   NOT NULL DEFAULT 'ko',
    publisher       VARCHAR(100)  NULL,
    file_format     VARCHAR(20)   NULL,
    page_count      INT           NULL,
    volume_label    VARCHAR(50)   NULL,
    publish_cycle   VARCHAR(20)   NULL,
    serial_status   VARCHAR(20)   NOT NULL DEFAULT 'ONGOING',
    publish_status  VARCHAR(20)   NOT NULL DEFAULT 'DRAFT',
    submitted_by_member_id BIGINT NULL,
    average_rating  DECIMAL(3, 2) NOT NULL DEFAULT 0.00,
    review_count    INT           NOT NULL DEFAULT 0,
    view_count      BIGINT        NOT NULL DEFAULT 0,
    recommend_count INT           NOT NULL DEFAULT 0,
    wishlist_count  INT           NOT NULL DEFAULT 0,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_book_slug UNIQUE (slug),
    INDEX idx_book_submitted_by_member (submitted_by_member_id),
    CONSTRAINT fk_book_submitted_by_member FOREIGN KEY (submitted_by_member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_book_content_type CHECK (content_type IN ('WEBNOVEL', 'BOOK', 'MAGAZINE')),
    CONSTRAINT ck_book_serial_status CHECK (serial_status IN ('ONGOING', 'HIATUS', 'COMPLETED')),
    CONSTRAINT ck_book_publish_status CHECK (publish_status IN ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'HIDDEN')),
    CONSTRAINT ck_book_average_rating CHECK (average_rating BETWEEN 0 AND 5),
    CONSTRAINT ck_book_review_count CHECK (review_count >= 0),
    CONSTRAINT ck_book_view_count CHECK (view_count >= 0),
    CONSTRAINT ck_book_recommend_count CHECK (recommend_count >= 0),
    CONSTRAINT ck_book_wishlist_count CHECK (wishlist_count >= 0),
    CONSTRAINT ck_book_page_count CHECK (page_count IS NULL OR page_count >= 1),
    FULLTEXT INDEX ft_book_title_publisher (title, publisher) WITH PARSER ngram
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 회차
-- uk_chapter_id_book은 회차를 참조하는 테이블의 (chapter_id, book_id) 복합 FK가 참조합니다.
CREATE TABLE chapter (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    book_id         BIGINT       NOT NULL,
    chapter_no      INT          NOT NULL,
    title           VARCHAR(200) NOT NULL,
    published_at    TIMESTAMP    NULL,
    char_count      INT          NOT NULL DEFAULT 0,
    summary         TEXT         NULL,
    category_label  VARCHAR(50)  NULL,
    start_page      INT          NULL,
    content_url     VARCHAR(500) NULL,
    content_version INT          NOT NULL DEFAULT 1,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_chapter_book_no UNIQUE (book_id, chapter_no),
    CONSTRAINT uk_chapter_id_book UNIQUE (id, book_id),
    CONSTRAINT fk_chapter_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_chapter_chapter_no CHECK (chapter_no >= 1),
    CONSTRAINT ck_chapter_char_count CHECK (char_count >= 0),
    CONSTRAINT ck_chapter_start_page CHECK (start_page IS NULL OR start_page >= 1),
    CONSTRAINT ck_chapter_content_version CHECK (content_version >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 작품_저자
CREATE TABLE book_author (
    id        BIGINT NOT NULL AUTO_INCREMENT,
    book_id   BIGINT NOT NULL,
    author_id BIGINT NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_book_author UNIQUE (book_id, author_id),
    CONSTRAINT fk_book_author_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_book_author_author FOREIGN KEY (author_id)
        REFERENCES author (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 작품_장르
CREATE TABLE book_genre (
    id       BIGINT NOT NULL AUTO_INCREMENT,
    book_id  BIGINT NOT NULL,
    genre_id BIGINT NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_book_genre UNIQUE (book_id, genre_id),
    CONSTRAINT fk_book_genre_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_book_genre_genre FOREIGN KEY (genre_id)
        REFERENCES genre (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 작품_카테고리
CREATE TABLE book_category (
    id          BIGINT NOT NULL AUTO_INCREMENT,
    book_id     BIGINT NOT NULL,
    category_id BIGINT NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_book_category UNIQUE (book_id, category_id),
    CONSTRAINT fk_book_category_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_book_category_category FOREIGN KEY (category_id)
        REFERENCES category (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
