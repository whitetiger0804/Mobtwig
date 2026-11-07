-- 가입 때 표시한 원문과 동의 이력을 문서 종류·버전별로 보존합니다.
CREATE TABLE member_policy_consent (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    member_id        BIGINT       NOT NULL,
    document_kind    VARCHAR(20)  NOT NULL,
    document_version VARCHAR(80)  NOT NULL,
    document_title   VARCHAR(255) NOT NULL,
    document_body    MEDIUMTEXT   NOT NULL,
    content_hash     CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    temporary        BOOLEAN      NOT NULL,
    agreed_at        TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_member_policy_consent_version UNIQUE (member_id, document_kind, document_version),
    CONSTRAINT ck_member_policy_consent_kind CHECK (document_kind IN ('TERMS', 'PRIVACY')),
    CONSTRAINT fk_member_policy_consent_member FOREIGN KEY (member_id)
        REFERENCES member (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
