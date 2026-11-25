package com.mobtwig.auth;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;

/** 기존 회원 행과 Spring Session 저장소만 사용합니다. */
@Repository
public class MemberPasswordRepository {
    private final JdbcTemplate jdbc;
    private final FindByIndexNameSessionRepository<? extends Session> sessions;
    public MemberPasswordRepository(JdbcTemplate jdbc, FindByIndexNameSessionRepository<? extends Session> sessions) {
        this.jdbc = jdbc; this.sessions = sessions;
    }

    Optional<String> lockHash(String id) {
        return jdbc.query("SELECT password_hash FROM member WHERE id=? AND status='ACTIVE' FOR UPDATE",
                (rs, row) -> rs.getString(1), id).stream().findFirst();
    }

    void replaceAndRevoke(String id, String hash) {
        jdbc.update("UPDATE member SET password_hash=? WHERE id=?", hash, id);
        // 같은 회원의 별도 ADMIN 세션은 유지합니다. 쿠키 이름이나 principal_name만으로 영역을 추측하지 않습니다.
        sessions.findByPrincipalName(id).values().stream()
                .filter(session -> AuthCookies.MEMBER.equals(session.getAttribute(AuthCookies.SCOPE)))
                .forEach(session -> jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=? AND PRINCIPAL_NAME=?", session.getId(), id));
    }
}
