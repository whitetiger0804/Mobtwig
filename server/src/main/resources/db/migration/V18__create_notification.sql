-- 회원별 알림을 저장합니다. 현재는 가입 환영 알림(NOTICE)만 생성합니다.
-- 회원 FK는 RESTRICT이므로 회원 행을 지우기 전에 이 테이블의 행을 먼저 정리해야 합니다.
CREATE TABLE notification (
    id         BIGINT       NOT NULL AUTO_INCREMENT,
    member_id  BIGINT       NOT NULL,
    type       VARCHAR(20)  NOT NULL,
    title      VARCHAR(100) NOT NULL,
    message    VARCHAR(500) NOT NULL,
    read_at    TIMESTAMP    NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_notification_member_created (member_id, created_at),
    CONSTRAINT fk_notification_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_notification_type CHECK (type IN ('NOTICE', 'COMMENT', 'WORK', 'EVENT')),
    CONSTRAINT ck_notification_title CHECK (CHAR_LENGTH(TRIM(title)) >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
