package com.mobtwig.auth;

import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

/** 가입 레코드, 기본 읽기 설정, 버전별 약관 및 동의 이력을 서비스 트랜잭션에서 저장합니다. */
@Repository
public class MemberSignupRepository {
    private static final String DUPLICATE_EMAIL = "이미 사용 중인 이메일입니다.";
    private static final String DUPLICATE_NICKNAME = "이미 사용 중인 닉네임입니다.";
    private final JdbcTemplate jdbc;

    public MemberSignupRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Map<String, String> duplicates(String email, String nickname) {
        Map<String, String> fields = new LinkedHashMap<>();
        if (!jdbc.queryForList("SELECT id FROM member WHERE email=?", Long.class, email).isEmpty()) {
            fields.put("email", DUPLICATE_EMAIL);
        }
        if (!jdbc.queryForList("SELECT id FROM member WHERE nickname=?", Long.class, nickname).isEmpty()) {
            fields.put("nickname", DUPLICATE_NICKNAME);
        }
        return fields;
    }

    public long insertMember(String email, String nickname, String passwordHash) {
        var keys = new GeneratedKeyHolder();
        try {
            jdbc.update(connection -> {
                var statement = connection.prepareStatement(
                        "INSERT INTO member(email,nickname,password_hash,role,status) VALUES (?,?,?,'USER','ACTIVE')",
                        Statement.RETURN_GENERATED_KEYS);
                statement.setString(1, email);
                statement.setString(2, nickname);
                statement.setString(3, passwordHash);
                return statement;
            }, keys);
        } catch (DuplicateKeyException conflict) {
            // 동시 가입은 DB의 UNIQUE 제약으로 판정하며 SQL 오류 원문은 응답하지 않습니다.
            String detail = conflict.getMostSpecificCause().getMessage();
            if (detail != null && detail.matches("(?s).*for key '[^']*\\buk_member_email'\\s*$")) {
                throw SignupFailure.conflict(Map.of("email", DUPLICATE_EMAIL));
            }
            if (detail != null && detail.matches("(?s).*for key '[^']*\\buk_member_nickname'\\s*$")) {
                throw SignupFailure.conflict(Map.of("nickname", DUPLICATE_NICKNAME));
            }
            throw SignupFailure.conflict(Map.of("request", "이미 가입된 정보가 있는지 확인해 주세요."));
        }
        var key = keys.getKey();
        if (key == null) throw new IllegalStateException("신규 회원 ID를 받지 못했습니다.");
        return key.longValue();
    }

    public void insertReadingSettings(long id) {
        jdbc.update("INSERT INTO member_reading_setting(member_id) VALUES (?)", id);
    }

    public void insertConsents(long id, List<SignupPolicies.Document> documents, Instant agreedAt) {
        var timestamp = Timestamp.from(agreedAt);
        for (var document : documents) {
            ensureDocumentVersion(document);
        }
        jdbc.batchUpdate("""
                INSERT INTO member_policy_consent (member_id,document_kind,document_version,agreed_at)
                VALUES (?,?,?,?)
                """, documents.stream().map(document ->
                new Object[]{id, document.kind(), document.version(), timestamp}).toList());
    }

    private void ensureDocumentVersion(SignupPolicies.Document document) {
        jdbc.update("""
                INSERT INTO policy_document_version
                    (document_kind,document_version,document_title,document_body,content_hash,temporary)
                VALUES (?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE document_kind=policy_document_version.document_kind
                """, document.kind(), document.version(), document.title(), document.body(),
                document.contentHash(), document.temporary());
        var stored = jdbc.queryForObject("""
                SELECT document_kind,document_version,document_title,document_body,content_hash,temporary
                FROM policy_document_version WHERE document_kind=? AND document_version=? FOR SHARE
                """, (row, number) -> new SignupPolicies.Document(row.getString(1), row.getString(2),
                row.getString(3), row.getString(4), row.getString(5), row.getBoolean(6)),
                document.kind(), document.version());
        if (!document.equals(stored)) {
            throw new IllegalStateException("등록된 약관 버전의 내용이 다릅니다. 새 버전을 발행해 주세요.");
        }
    }
}
