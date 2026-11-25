package com.mobtwig.auth;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.security.core.Authentication;

/** 세션 주체의 활성 상태 조회와 회원 쓰기 잠금을 처리합니다. */
@Service
public class MemberSessions {
    private final JdbcTemplate jdbc;
    /** @param jdbc UTC 연결을 사용하는 회원 조회 접근기입니다. */
    public MemberSessions(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /** 요청 파라미터가 아닌 인증 주체의 ID로 본인 정보를 조회합니다. */
    public Optional<Identity> current(String principal) {
        return jdbc.query("SELECT id,email,nickname,created_at FROM member WHERE id=? AND status='ACTIVE'",
                (rs, row) -> new Identity(Long.toString(rs.getLong("id")), rs.getString("email"),
                        rs.getString("nickname"), rs.getTimestamp("created_at").toInstant().toString()), principal).stream().findFirst();
    }

    /** 인증 때 사용한 해시 버전으로 검사하며 과거 형식·폐기된 회원 인증은 거부합니다. */
    public boolean authorized(Authentication authentication) {
        if (!(authentication.getPrincipal() instanceof CredentialPrincipal principal)) return false;
        return jdbc.query("SELECT password_hash FROM member WHERE id=? AND status='ACTIVE'",
                (rs, row) -> principal.matchesVersion(rs.getString(1)), authentication.getName()).stream().findFirst().orElse(false);
    }

    /**
     * 호출자의 쓰기 트랜잭션에서 작품보다 먼저 활성 회원을 잠급니다.
     * @param member 인증된 회원 ID입니다.
     * @throws ResponseStatusException 현재 활성 회원이 아니면 401로 거부합니다.
     */
    public void lockActiveMember(long member) {
        if (jdbc.queryForList("SELECT id FROM member WHERE id=? AND status='ACTIVE' FOR UPDATE",
                Long.class, member).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "활성 회원 세션이 필요합니다.");
        }
    }

    /** 비밀번호·역할·세션 식별자를 제외한 현재 회원 정보입니다. */
    public record Identity(String id, String email, String nickname, String createdAt) { }
}
