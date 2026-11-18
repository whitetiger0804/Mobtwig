-- 실제 과금 없이 구매·소장 권한을 검증하는 과제용 상품과 구매 기록입니다.
-- 도서·매거진은 chapter_id=NULL, 웹소설은 회차별 상품입니다. 종류 규칙은 서비스에서 검증합니다.
CREATE TABLE purchase_product (
    id          BIGINT      NOT NULL AUTO_INCREMENT,
    book_id     BIGINT      NOT NULL,
    chapter_id  BIGINT      NULL,
    target_key  BIGINT      GENERATED ALWAYS AS (COALESCE(chapter_id, 0)) STORED,
    price       INT         NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_purchase_product_target UNIQUE (book_id, target_key),
    CONSTRAINT fk_purchase_product_book FOREIGN KEY (book_id)
        REFERENCES book (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_purchase_product_chapter FOREIGN KEY (chapter_id, book_id)
        REFERENCES chapter (id, book_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_purchase_product_price CHECK (price >= 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE purchase (
    id                  BIGINT       NOT NULL AUTO_INCREMENT,
    member_id           BIGINT       NOT NULL,
    product_id          BIGINT       NOT NULL,
    request_key         VARCHAR(36)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    work_slug           VARCHAR(100) NOT NULL,
    content_type        VARCHAR(20)  NOT NULL,
    title               VARCHAR(200) NOT NULL,
    image_url           VARCHAR(500) NOT NULL,
    chapter_id          BIGINT       NULL,
    chapter_title       VARCHAR(200) NULL,
    price               INT          NOT NULL,
    purchased_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_purchase_request UNIQUE (member_id, request_key),
    CONSTRAINT uk_purchase_member_product UNIQUE (member_id, product_id),
    INDEX idx_purchase_member_time (member_id, purchased_at, id),
    CONSTRAINT fk_purchase_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_purchase_product FOREIGN KEY (product_id)
        REFERENCES purchase_product (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_purchase_price CHECK (price >= 0),
    CONSTRAINT ck_purchase_kind CHECK
        ((content_type IN ('BOOK', 'MAGAZINE') AND chapter_id IS NULL AND chapter_title IS NULL)
         OR (content_type = 'WEBNOVEL' AND chapter_id IS NOT NULL AND chapter_title IS NOT NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
