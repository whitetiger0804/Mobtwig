CREATE TABLE work_subscription (
    member_id BIGINT NOT NULL,
    book_id BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (member_id, book_id),
    CONSTRAINT fk_work_subscription_member FOREIGN KEY (member_id) REFERENCES member (id),
    CONSTRAINT fk_work_subscription_book FOREIGN KEY (book_id) REFERENCES book (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
