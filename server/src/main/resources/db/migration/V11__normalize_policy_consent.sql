-- 동일 버전에 서로 다른 원문이 있으면 기본 키 충돌로 중단하며 기존 동의 행을 보존합니다.
CREATE TABLE policy_document_version (
    document_kind    VARCHAR(20)  NOT NULL,
    document_version VARCHAR(80)  NOT NULL,
    document_title   VARCHAR(255) NOT NULL,
    document_body    MEDIUMTEXT   NOT NULL,
    content_hash     CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    temporary        BOOLEAN      NOT NULL,
    PRIMARY KEY (document_kind, document_version),
    CONSTRAINT ck_policy_document_version_kind CHECK (document_kind IN ('TERMS', 'PRIVACY'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

INSERT INTO policy_document_version
    (document_kind, document_version, document_title, document_body, content_hash, temporary)
SELECT source.document_kind, source.document_version, source.document_title,
       source.document_body, source.content_hash, source.temporary
FROM member_policy_consent source
JOIN (
    SELECT MIN(id) AS first_id FROM member_policy_consent GROUP BY document_kind, document_version
) versions ON versions.first_id = source.id
UNION ALL
SELECT first.document_kind, first.document_version, first.document_title,
       first.document_body, first.content_hash, first.temporary
FROM member_policy_consent candidate
JOIN (
    SELECT MIN(id) AS first_id FROM member_policy_consent GROUP BY document_kind, document_version
) versions
JOIN member_policy_consent first ON first.id = versions.first_id
    AND first.document_kind = candidate.document_kind AND first.document_version = candidate.document_version
WHERE CAST(first.document_kind AS BINARY) <> CAST(candidate.document_kind AS BINARY)
   OR CAST(first.document_version AS BINARY) <> CAST(candidate.document_version AS BINARY)
   OR CAST(first.document_title AS BINARY) <> CAST(candidate.document_title AS BINARY)
   OR CAST(first.document_body AS BINARY) <> CAST(candidate.document_body AS BINARY)
   OR first.content_hash <> candidate.content_hash OR first.temporary <> candidate.temporary;

ALTER TABLE member_policy_consent
    ADD CONSTRAINT fk_member_policy_consent_document FOREIGN KEY (document_kind, document_version)
        REFERENCES policy_document_version (document_kind, document_version) ON DELETE RESTRICT ON UPDATE RESTRICT,
    DROP COLUMN document_title,
    DROP COLUMN document_body,
    DROP COLUMN content_hash,
    DROP COLUMN temporary;
