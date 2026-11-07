package com.mobtwig.auth;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** 세션 주체의 현재 활성 상태와 공개 표시 정보만 조회합니다. */
@Service
public class MemberSessions {
    private final JdbcTemplate jdbc;
    /** @param jdbc UTC 연결을 사용하는 회원 조회 접근기입니다. */
    public MemberSessions(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /** 요청 파라미터가 아닌 인증 주체의 ID로 본인 정보를 조회합니다. */
    public Optional<Identity> current(String principal) {
        return jdbc.query("SELECT id,email,nickname,created_at FROM member WHERE id=? AND status='ACTIVE' AND role IN ('USER','ADMIN')",
                (rs, row) -> new Identity(Long.toString(rs.getLong("id")), rs.getString("email"),
                        rs.getString("nickname"), rs.getTimestamp("created_at").toInstant().toString()), principal).stream().findFirst();
    }

    /** 비밀번호·역할·세션 식별자를 제외한 현재 회원 정보입니다. */
    public record Identity(String id, String email, String nickname, String createdAt) { }
}
